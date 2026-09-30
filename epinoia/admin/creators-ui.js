'use strict';
/* ============================================================================
   CREATORS AND NEWS SOURCES — the console's side of migration 0194.

   The league console (mount):
     THE SWITCH     show the league's independent creators on its pages, or not
                    (off: nothing of theirs is shown anywhere; nothing is deleted)
     OUTLETS        open one for a creator, naming its owner by the email they sign
                    in with (it can be given before they have ever signed in);
                    suspend one, or let it back; open its studio
     MODERATION     the latest pieces, each hidden or shown again with one press
     NEWS SOURCES   the league's own news sites, read by their feeds every half hour
                    (mountSources): on the league's news page, and every reader's News

   The platform console mounts mountSources with no league: the sources every reader
   sees, the sites that cover everything (Eurohoops, BasketNews…).

   The database decides every one of these (set_league_creators, create_creator_outlet,
   set_creator_outlet_status, hide_creator_post, add_news_source …); what it refuses is
   said in its own words.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaCreatorsUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const errText = e => (e && (e.message || e.hint || e.details)) || String(e || 'refused');
const when = iso => { if (!iso) return 'never'; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
const https = u => /^https:\/\/[^\s<>"]+$/i.test(String(u || '').trim());
const webUrl = u => /^https?:\/\/[^\s<>"]+$/i.test(String(u || '').trim());

function input(ph, max, value) {
  const i = el('input', 'ep-input');
  i.placeholder = ph || ''; if (max) i.maxLength = max; if (value) i.value = value;
  return i;
}
function btn(label, cls) { const b = el('button', 'ep-btn mini' + (cls ? ' ' + cls : ''), label); b.type = 'button'; return b; }
function row(...kids) { const r = el('div', 'row'); r.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0'; kids.forEach(k => r.appendChild(k)); return r; }
function h(t) { return el('div', 'fmt-h', t); }

/* ------------------------------------------------------------------ the league ---- */
function mount(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host) return;
  const sb = o.sb, say = o.say || (() => {});
  const lg = () => (typeof o.league === 'function' ? o.league() : o.league);
  const base = o.base || '../';
  host.textContent = '';
  const top = el('div'), out = el('div'), mod = el('div'), src = el('div');
  host.append(top, out, mod, src);

  async function draw() {
    const league = lg();
    if (!league) return;
    const { data, error } = await sb.rpc('creators_admin', { p_league: league.id });
    top.textContent = ''; out.textContent = ''; mod.textContent = '';
    if (error) {
      top.appendChild(el('p', 'empty', /does not exist|schema cache/i.test(errText(error))
        ? 'Creators arrive with migration 0194: it has not been applied to this database yet.'
        : 'Could not read the creators: ' + errText(error)));
      return;
    }
    if (league.id !== (lg() || {}).id) return;                  // the league changed under us

    /* the switch */
    top.appendChild(el('p', 'empty',
      'Independent creators — a podcast, a YouTube channel, a writer — each get an outlet on the league’s pages: ' +
      'their own page, their pieces on the front page and in the news, and a bell fans can follow. They are not the ' +
      'league’s voice, and the pages say so. You open an outlet and name its owner; they run it from the creator studio.'));
    const sw = el('input'); sw.type = 'checkbox'; sw.checked = !!data.enabled; sw.setAttribute('role', 'switch'); sw.className = 'sw';
    const lab = el('label', 'sw-row');
    lab.style.cssText = 'display:flex;gap:10px;align-items:center;margin:8px 0 14px;font-family:var(--f-ui);font-size:14px';
    lab.append(sw, el('span', null, 'Show creators on ' + league.name + '’s pages'));
    sw.addEventListener('change', async () => {
      const { error: e } = await sb.rpc('set_league_creators', { p_league: league.id, p_on: sw.checked });
      if (e) { sw.checked = !sw.checked; return say(errText(e), 'err'); }
      say(sw.checked ? 'Creators are on: their pieces show on the front page and in the news.' : 'Creators are off: nothing of theirs is shown. Nothing was deleted.', 'ok');
    });
    top.appendChild(lab);

    /* the outlets */
    out.appendChild(h('Outlets'));
    const outs = data.outlets || [];
    if (!outs.length) out.appendChild(el('p', 'empty', 'No outlets yet.'));
    outs.forEach(x => {
      const people = (x.members || []).map(m => m.email + (m.role === 'owner' ? ' (owner)' : '')).join(', ');
      const line = el('div');
      line.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--rule)';
      const name = el('b', null, x.name);
      const meta = el('span', 'empty', (x.status === 'suspended' ? 'SUSPENDED · ' : '') + x.published + ' published' +
        (x.hidden ? ', ' + x.hidden + ' hidden' : '') + ' · ' + (people || 'nobody'));
      meta.style.cssText = 'flex:1 1 260px;margin:0';
      const studio = el('a', 'ep-btn mini', 'studio'); studio.href = base + 'creators/studio/?o=' + encodeURIComponent(x.id);
      const page = el('a', 'ep-btn mini', 'page'); page.href = base + 'creators/?l=' + encodeURIComponent(league.slug) + '&o=' + encodeURIComponent(x.slug);
      const toggle = btn(x.status === 'suspended' ? 'let back' : 'suspend');
      toggle.addEventListener('click', async () => {
        const next = x.status === 'suspended' ? 'active' : 'suspended';
        if (next === 'suspended' && !confirm('Suspend ' + x.name + '? Nothing of it is shown and nothing can be published until you let it back.')) return;
        const { error: e } = await sb.rpc('set_creator_outlet_status', { p_outlet: x.id, p_status: next });
        if (e) return say(errText(e), 'err');
        say(next === 'suspended' ? x.name + ' is suspended.' : x.name + ' is back.', 'ok');
        draw();
      });
      line.append(name, meta, studio, page, toggle);
      out.appendChild(line);
    });
    const nm = input('the outlet’s name', 80), em = input('its owner’s email', 200);
    em.type = 'email';
    const add = btn('Open the outlet', 'pri');
    add.addEventListener('click', async () => {
      const { error: e } = await sb.rpc('create_creator_outlet', { p_league: league.id, p_name: nm.value, p_owner_email: em.value });
      if (e) return say(errText(e), 'err');
      say('Opened. ' + em.value.trim() + ' runs it from the creator studio the moment they sign in with that address.', 'ok');
      nm.value = ''; em.value = '';
      draw();
    });
    out.appendChild(row(nm, em, add));

    /* moderation */
    const posts = data.posts || [];
    if (posts.length) {
      mod.appendChild(h('Latest pieces'));
      posts.slice(0, 25).forEach(p => {
        const line = el('div');
        line.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--rule)';
        const t = el('a', null, p.title);
        t.href = base + 'creators/?l=' + encodeURIComponent(league.slug) + '&o=' + encodeURIComponent(p.outlet_slug) + '&p=' + encodeURIComponent(p.slug);
        t.style.cssText = 'flex:1 1 260px;color:var(--ink)';
        const meta = el('span', 'empty', p.outlet + ' · ' + p.kind + ' · ' + when(p.published_at) + (p.hidden ? ' · HIDDEN' : ''));
        meta.style.margin = '0';
        const b = btn(p.hidden ? 'show' : 'hide');
        b.addEventListener('click', async () => {
          const { error: e } = await sb.rpc('hide_creator_post', { p_post: p.id, p_hidden: !p.hidden });
          if (e) return say(errText(e), 'err');
          say(p.hidden ? 'Shown again.' : 'Hidden: gone from every page. Its outlet still sees it, marked hidden.', 'ok');
          draw();
        });
        line.append(t, meta, b);
        mod.appendChild(line);
      });
    }
  }
  draw();
  mountSources({ host: src, sb, say, league: lg, base });
}

/* ------------------------------------------------------ the league's forum ---- */
/* THE FORUM (0197): the Discord servers where the league's fans talk, on forum/?l= and a forum row on the rail
   once there is one. ANY server, the league's own or not - a fans' community, a club's: nothing here makes one.
   Paste a server's invitation and Discord's own public answer for it (no sign-in) fills in the server's id, name
   and picture. The live widget needs the id, and the server's owner to switch the widget on in Discord. */
const DISCORD_INVITE = /^https:\/\/(discord\.gg|discord\.com\/invite)\/([A-Za-z0-9-]{2,40})\/?$/i;
const inviteCode = u => { const m = DISCORD_INVITE.exec(String(u || '').trim()); return m ? m[2] : null; };
/* what Discord says about an invitation: the server's id, name and picture, its numbers, and when it expires */
async function lookUpInvite(url, fetchFn) {
  const code = inviteCode(url);
  if (!code) return { error: 'An invitation is a discord.gg or discord.com/invite address.' };
  let r;
  try { r = await (fetchFn || fetch)('https://discord.com/api/v10/invites/' + encodeURIComponent(code) + '?with_counts=true', { cache: 'no-store', credentials: 'omit' }); }
  catch (_) { return { error: 'Discord could not be reached just now: fill the server in by hand, or try again.' }; }
  if (r.status === 404) return { error: 'Discord does not know that invitation: it has expired, or was deleted.' };
  if (!r.ok) return { error: 'Discord did not answer (' + r.status + '): fill the server in by hand, or try again in a minute.' };
  const j = await r.json().catch(() => null);
  const g = j && j.guild;
  if (!g || !/^[0-9]{15,22}$/.test(String(g.id || ''))) return { error: 'That invitation is not to a server.' };
  return {
    server_id: String(g.id), name: String(g.name || '').trim().slice(0, 80),
    icon_url: /^[A-Za-z0-9_]{1,80}$/.test(String(g.icon || '')) ? 'https://cdn.discordapp.com/icons/' + g.id + '/' + g.icon + '.png?size=128' : null,
    members: Number(j.approximate_member_count) || 0, online: Number(j.approximate_presence_count) || 0, expires_at: j.expires_at || null
  };
}

function mountForum(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host) return;
  const sb = o.sb, say = o.say || (() => {});
  const lg = () => (typeof o.league === 'function' ? o.league() : o.league);
  const base = o.base || '../';
  host.textContent = '';
  const box = el('div');
  host.appendChild(box);
  let clubs = { league: null, rows: [] };

  async function draw() {
    const league = lg();
    if (!league) return;
    const [{ data, error }, t] = await Promise.all([
      sb.rpc('league_discords_admin', { p_league: league.id }),
      clubs.league === league.id ? Promise.resolve(null) : sb.from('teams').select('id,name').eq('league_id', league.id).order('name')
    ]);
    if (t && !t.error) clubs = { league: league.id, rows: t.data || [] };
    box.textContent = '';
    if (error) {
      box.appendChild(el('p', 'empty', /does not exist|schema cache/i.test(errText(error))
        ? 'The forum arrives with migration 0197: it has not been applied to this database yet.'
        : 'Could not read the forum: ' + errText(error)));
      return;
    }
    if (league.id !== (lg() || {}).id) return;
    box.appendChild(el('p', 'empty',
      'The Discord servers where ' + league.name + '’s fans talk, on the league’s forum page and its rail. Any server: the ' +
      'league’s own, a fans’ community, a club’s. Nothing is created here; you attach servers that exist. Paste a server’s ' +
      'invitation and its name, picture and id are read from Discord. The live widget shows once the server’s owner turns it on in ' +
      'Discord (Server Settings, Widget, Enable Server Widget).'));
    const list = Array.isArray(data) ? data : [];
    if (!list.length) box.appendChild(el('p', 'empty', 'No servers attached yet.'));
    list.forEach((x, i) => box.appendChild(line(league, x, i, list.length)));
    box.appendChild(h(list.length ? 'Attach another server' : 'Attach a server'));
    box.appendChild(editor(league, null));
    if (list.length) {
      const open = el('a', 'ep-btn mini', 'the forum page ↗');
      open.href = base + 'forum/?l=' + encodeURIComponent(league.slug || '');
      open.target = '_blank'; open.rel = 'noopener';
      box.appendChild(row(open));
    }
  }

  function line(league, x, i, n) {
    const wrap = el('div');
    wrap.style.cssText = 'border-top:1px solid var(--rule);padding:8px 0';
    const r = el('div');
    r.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap';
    const ic = el('span');
    ic.style.cssText = 'flex:0 0 28px;width:28px;height:28px;border-radius:50%;overflow:hidden;background:#5865F2;display:inline-grid;place-items:center;color:#fff;font-size:11px';
    if (https(x.icon_url)) { const img = el('img'); img.src = x.icon_url; img.alt = ''; img.style.cssText = 'width:100%;height:100%;object-fit:cover'; ic.appendChild(img); }
    else ic.textContent = (x.name || '?').slice(0, 2).toUpperCase();
    const club = x.team_id && clubs.rows.find(c => c.id === x.team_id);
    const name = el('b', null, x.name);
    const meta = el('span', 'empty', [x.official ? 'OFFICIAL' : club ? club.name.toUpperCase() : 'COMMUNITY',
      x.server_id ? 'widget: server ' + x.server_id : 'no widget (no server id)',
      x.invite ? x.invite.replace(/^https:\/\//, '') : 'no invitation'].join(' · '));
    meta.style.cssText = 'flex:1 1 260px;margin:0';
    const up = btn('↑'), down = btn('↓'), edit = btn('edit'), off = btn('take off');
    up.disabled = i === 0; down.disabled = i === n - 1;
    up.title = 'one place up'; down.title = 'one place down';
    const move = by => async () => {
      const { error: e } = await sb.rpc('move_league_discord', { p_id: x.id, p_by: by });
      if (e) return say(errText(e), 'err');
      draw();
    };
    up.addEventListener('click', move(-1));
    down.addEventListener('click', move(1));
    off.addEventListener('click', async () => {
      if (!confirm('Take ' + x.name + ' off ' + league.name + '’s forum? The server itself is not touched.')) return;
      const { error: e } = await sb.rpc('remove_league_discord', { p_id: x.id });
      if (e) return say(errText(e), 'err');
      say(x.name + ' is off the forum.', 'ok');
      draw();
    });
    let open = null;
    edit.addEventListener('click', () => {
      if (open) { open.remove(); open = null; return; }
      open = editor(league, x);
      wrap.appendChild(open);
    });
    r.append(ic, name, meta, up, down, edit, off);
    wrap.appendChild(r);
    return wrap;
  }

  function editor(league, x) {
    const f = el('div');
    f.style.cssText = 'margin:6px 0 12px';
    const inv = input('invitation, e.g. https://discord.gg/abc123', 80, (x && x.invite) || '');
    inv.type = 'url';
    inv.style.width = 'min(100%, 460px)';
    const look = btn('Read it from Discord');
    const found = el('p', 'empty');
    found.style.margin = '2px 0 6px';
    const nm = input('the server’s name', 80, (x && x.name) || '');
    const sid = input('server id, for the live widget', 22, (x && x.server_id) || '');
    sid.inputMode = 'numeric';
    sid.style.width = 'min(100%, 260px)';
    const note = input('a line about it, if you like: e.g. fan-run, game threads every night', 200, (x && x.note) || '');
    note.style.width = 'min(100%, 620px)';
    const club = el('select', 'ep-input');
    const none = el('option', null, 'not a club’s server'); none.value = ''; club.appendChild(none);
    clubs.rows.forEach(c => { const op = el('option', null, c.name + '’s'); op.value = c.id; club.appendChild(op); });
    club.value = (x && x.team_id) || '';
    const official = el('input'); official.type = 'checkbox'; official.checked = !!(x && x.official);
    const offL = el('label');
    offL.style.cssText = 'display:inline-flex;gap:6px;align-items:center;font-family:var(--f-ui);font-size:13px';
    offL.append(official, el('span', null, 'the league’s own, official server'));
    let icon = (x && x.icon_url) || null, autoName = false, lastLooked = ((x && x.invite) || '').trim(), timer = 0;
    found.style.minHeight = '1.6em';
    nm.addEventListener('input', () => { autoName = false; });
    look.addEventListener('click', async () => {
      lastLooked = inv.value.trim();
      look.disabled = true;
      found.textContent = 'Asking Discord…';
      const r = await lookUpInvite(inv.value);
      look.disabled = false;
      if (r.error) { found.textContent = r.error; return; }
      sid.value = r.server_id;
      if (!nm.value.trim() || autoName) { nm.value = r.name; autoName = true; }
      icon = r.icon_url;
      found.textContent = 'Found: ' + r.name +
        (r.members ? ' · ' + r.members.toLocaleString() + ' members' : '') +
        (r.online ? ' · ' + r.online.toLocaleString() + ' online' : '') +
        (r.expires_at ? '. This invitation expires ' + when(r.expires_at) + ': make one that never expires (in Discord: Invite People, ' +
          'Edit invite link, Expire after: Never).' : '.');
    });
    /* a pasted invitation is read as it arrives, once. Not on 'change': that fires when the field loses focus - on
       the press of Attach itself - and the lookup's line reflowing under the pointer would swallow the press. */
    inv.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { const v = inv.value.trim(); if (inviteCode(v) && v !== lastLooked) look.click(); }, 350);
    });
    const save = btn(x ? 'Save' : 'Attach the server', 'pri');
    save.addEventListener('click', async () => {
      const p = { invite: inv.value.trim(), server_id: sid.value.trim(), name: nm.value.trim(), note: note.value.trim(),
                  icon_url: icon, team_id: club.value || null, official: official.checked };
      /* a picture read for one server is never kept for another */
      if (p.icon_url && !(p.server_id && p.icon_url.indexOf('/icons/' + p.server_id + '/') > 0)) p.icon_url = null;
      if (!p.invite && !p.server_id) return say('Give the server’s invitation, its id, or both.', 'err');
      if (p.invite && !inviteCode(p.invite)) return say('An invitation is a discord.gg or discord.com/invite address.', 'err');
      if (p.server_id && !/^[0-9]{15,22}$/.test(p.server_id)) return say('A Discord server id is the long number in Server Settings, Widget.', 'err');
      if (!p.name) return say('Give the server a name, or read it from Discord.', 'err');
      if (x) p.id = x.id;
      save.disabled = true;
      const { error: e } = await sb.rpc('save_league_discord', { p_league: league.id, p });
      save.disabled = false;
      if (e) return say(errText(e), 'err');
      say(x ? 'Saved.' : p.name + ' is on the league’s forum' + (p.server_id ? '.' : ' (no live widget without its server id).'), 'ok');
      draw();
    });
    f.append(row(inv, look), found, row(nm, sid), row(note), row(club, offL), row(save));
    return f;
  }
  draw();
}

/* ------------------------------------------------------------- news sources ---- */
/* WHAT A PASTED LINK IS (0198), said before it is sent: what the reader will look for behind it, and whether it
   is a creator's or a publisher's to begin with. The platforms that publish no feed anyone may read without the
   account owner's permission are said so, with what can be done instead; the database refuses them too. */
const LINK_KINDS = [
  { re: /^https?:\/\/(www\.|m\.|music\.)?youtube\.com\//i, platform: 'youtube', what: 'a YouTube channel: its new videos', kind: 'creator' },
  { re: /^https?:\/\/podcasts\.apple\.com\/.*\/id\d{5,12}/i, platform: 'podcast', what: 'an Apple Podcasts show: its new episodes', kind: 'creator' },
  { re: /^https?:\/\/bsky\.app\/profile\/[^/\s]+/i, platform: 'bluesky', what: 'a Bluesky account: its posts', kind: 'creator' },
  { re: /^https?:\/\/[a-z0-9-]+\.substack\.com/i, platform: 'substack', what: 'a Substack: its posts', kind: 'creator' },
  { re: /^https?:\/\/([a-z0-9-]+\.)?medium\.com\//i, platform: 'medium', what: 'a Medium writer: their stories', kind: 'creator' },
  { re: /^https?:\/\/[^/\s]+\/@[A-Za-z0-9_.-]+\/?$/i, platform: 'mastodon', what: 'a Mastodon account (or one like it): its posts', kind: 'creator' },
  { re: /(\/feed\/?|\/rss\/?|\.rss|\.xml|\/atom\/?|\/feed\.json)(\?[^\s]*)?$/i, platform: 'feed', what: 'a feed: its items', kind: 'publisher' }
];
const NO_FEED_LINKS = [
  { re: /^https?:\/\/([a-z0-9-]+\.)?instagram\.com(\/|$)/i, name: 'Instagram', via: 'Meta' },
  { re: /^https?:\/\/([a-z0-9-]+\.)?tiktok\.com(\/|$)/i, name: 'TikTok', via: 'TikTok' },
  { re: /^https?:\/\/([a-z0-9-]+\.)?(x|twitter)\.com(\/|$)/i, name: 'X', via: 'X' },
  { re: /^https?:\/\/([a-z0-9-]+\.)?threads\.(net|com)(\/|$)/i, name: 'Threads', via: 'Meta' },
  { re: /^https?:\/\/([a-z0-9-]+\.)?(facebook|fb)\.com(\/|$)/i, name: 'Facebook', via: 'Meta' },
  { re: /^https?:\/\/open\.spotify\.com(\/|$)/i, name: 'Spotify', via: 'Spotify' }
];
const PLATFORM_NAMES = { youtube: 'YouTube', podcast: 'podcast', bluesky: 'Bluesky', substack: 'Substack', medium: 'Medium',
  mastodon: 'Mastodon', feed: 'feed', website: 'website' };
function recogniseLink(url) {
  const u = String(url || '').trim();
  if (!u) return null;
  if (!/^https?:\/\/[^\s<>"]+$/i.test(u)) return { error: 'Paste the whole link, starting https://' };
  const no = NO_FEED_LINKS.find(x => x.re.test(u));
  if (no) {
    return { refused: no.name, why: no.name === 'Spotify'
      ? 'Spotify shows no public feed of a show. Most podcasts are on Apple Podcasts too: paste that link, or the podcast’s own feed.'
      : no.name + ' publishes no feed that can be read without the account owner’s permission, so its posts cannot arrive here on their own. ' +
        'Instead: add the same creator’s YouTube channel, podcast, website, Substack or Bluesky; or embed single posts in a creator’s ' +
        'outlet on a league. Reading ' + no.name + ' itself would need the account owner to connect it through ' + no.via + '’s own API.' };
  }
  const k = LINK_KINDS.find(x => x.re.test(u));
  return k ? { platform: k.platform, what: k.what, kind: k.kind }
           : { platform: 'website', what: 'a website: the feed it names, or one in the usual places', kind: 'publisher' };
}

function mountSources(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host) return;
  const sb = o.sb, say = o.say || (() => {});
  const lg = () => (typeof o.league === 'function' ? o.league() : o.league) || null;
  host.textContent = '';
  const box = el('div');
  host.appendChild(box);

  async function draw() {
    const league = lg();
    const lid = league ? league.id : null;
    const { data, error } = await sb.rpc('news_sources_admin', { p_league: lid });
    box.textContent = '';
    box.appendChild(h(league ? 'Publishers & creators' : 'Publishers & creators for every reader'));
    if (error) {
      box.appendChild(el('p', 'empty', /does not exist|schema cache/i.test(errText(error))
        ? 'News sources arrive with migration 0194: it has not been applied to this database yet.'
        : 'Could not read the sources: ' + errText(error)));
      return;
    }
    box.appendChild(el('p', 'empty', (league
      ? 'News sites and creators of ' + league.name + '’s own, on the league’s news page and in every reader’s News. '
      : 'What every reader sees in News; each story also lands on the news page of every league it is about (its league tags). ') +
      'Paste a link: a website, a feed, a YouTube channel, a podcast, a Substack, Medium, Bluesky or Mastodon account. The feed behind ' +
      'it is found at the next read (every half hour) and every new post arrives from then on, with its followers told. A logo is found too.'));

    /* ---- add by link ---- */
    const link = input('paste a link: https://www.youtube.com/@…, a website, a podcast…', 500);
    link.type = 'url';
    link.style.width = 'min(100%, 520px)';
    const kind = el('select', 'ep-input');
    [['publisher', 'a publisher'], ['creator', 'a creator']].forEach(([v, t]) => { const op = el('option', null, t); op.value = v; kind.appendChild(op); });
    const nm = input('its name (optional: read from it)', 80);
    const add = btn('Add', 'pri');
    const said = el('p', 'empty');
    said.style.cssText = 'margin:2px 0 8px;min-height:1.4em';
    let kindTouched = false;
    kind.addEventListener('change', () => { kindTouched = true; });
    const tell = () => {
      const r = recogniseLink(link.value);
      add.disabled = !!(r && (r.refused || r.error));
      if (!r) { said.textContent = ''; return; }
      if (r.error) { said.textContent = r.error; return; }
      if (r.refused) { said.textContent = r.why; return; }
      if (!kindTouched) kind.value = r.kind;
      said.textContent = 'That is ' + r.what + '.';
    };
    link.addEventListener('input', tell);
    add.addEventListener('click', async () => {
      const r = recogniseLink(link.value);
      if (!r || r.error || r.refused) return say((r && (r.error || r.why)) || 'Paste a link first.', 'err');
      add.disabled = true;
      const { data: d, error: e } = await sb.rpc('add_news_link', { p_league: lid, p_url: link.value.trim(), p_kind: kind.value,
        p_name: nm.value.trim() || null });
      add.disabled = false;
      if (e) {
        return say(/add_news_link|schema cache|does not exist/i.test(errText(e))
          ? 'Adding by link arrives with migration 0198: it has not been applied to this database yet.' : errText(e), 'err');
      }
      say('Added ' + ((d && d.name) || 'it') + ': its feed is found at the next read (within half an hour), and its posts arrive from then on.', 'ok');
      draw();
    });
    box.appendChild(row(link, kind, nm, add));
    box.appendChild(said);

    /* ---- the list ---- */
    (data || []).forEach(s => {
      const line = el('div');
      line.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--rule)';
      const logo = el('span');
      logo.style.cssText = 'width:26px;height:26px;flex:none;display:grid;place-items:center;overflow:hidden;background:#fff;border:1px solid var(--rule)';
      if (s.logo_url) { const i = el('img'); i.src = s.logo_url.replace(/#fill$/, ''); i.alt = ''; i.style.cssText = 'width:90%;height:90%;object-fit:contain'; logo.appendChild(i); }
      const name = el('b', null, s.name);
      const isCreator = s.kind === 'creator';
      const what = (isCreator ? 'CREATOR' : 'PUBLISHER') + (s.platform ? ' · ' + (PLATFORM_NAMES[s.platform] || s.platform) : '');
      const state = s.resolve_from
        ? (s.last_error ? 'no feed found yet: ' + s.last_error : 'waiting for its first read, when the feed behind the link is found')
        : !s.enabled ? 'off' : s.last_error ? 'failing: ' + s.last_error : s.last_ok_at ? 'read ' + when(s.last_ok_at) : 'not read yet';
      const meta = el('span', 'empty', what + ' · ' + state + ' · ' + (s.item_count || 0) + ' posts · ' + (s.resolve_from || s.feed_url));
      meta.style.cssText = 'flex:1 1 300px;margin:0;overflow-wrap:anywhere' + (s.last_error && s.enabled ? ';color:var(--flare)' : '');
      const page = el('a', 'ep-btn mini', 'page'); page.href = (o.base || '../') + 'news/?s=' + encodeURIComponent(s.slug);
      const flip = btn(isCreator ? 'a publisher' : 'a creator');
      flip.title = 'call it ' + (isCreator ? 'a publisher: its posts under Publishers' : 'a creator: its posts under Creators');
      flip.addEventListener('click', async () => {
        const { error: e } = await sb.rpc('set_news_source_kind', { p_id: s.id, p_kind: isCreator ? 'publisher' : 'creator' });
        if (e) return say(errText(e), 'err');
        say(s.name + ' is ' + (isCreator ? 'a publisher' : 'a creator') + ' now.', 'ok');
        draw();
      });
      const onoff = btn(s.enabled ? 'switch off' : 'switch on');
      onoff.addEventListener('click', async () => {
        const { error: e } = await sb.rpc('update_news_source', { p_id: s.id, p_name: s.name, p_site_url: s.site_url, p_feed_url: s.feed_url,
          p_logo_url: s.logo_url, p_colour: s.colour, p_enabled: !s.enabled });
        if (e) return say(errText(e), 'err');
        say(s.enabled ? s.name + ' is off: its posts leave the pages.' : s.name + ' is on again.', 'ok');
        draw();
      });
      const edit = btn('edit');
      edit.addEventListener('click', () => { line.replaceWith(editor(s)); });
      const del = btn('remove');
      del.addEventListener('click', async () => {
        if (!confirm('Remove ' + s.name + ' and every post of it on Epinoia?')) return;
        const { error: e } = await sb.rpc('delete_news_source', { p_id: s.id });
        if (e) return say(errText(e), 'err');
        say(s.name + ' is removed.', 'ok');
        draw();
      });
      if (s.kind === undefined) flip.hidden = true;                 // before 0198: every source is a publisher
      line.append(logo, name, meta, page, flip, onoff, edit, del);
      box.appendChild(line);
    });

    /* ---- the long way: a site and its feed, typed in ---- */
    const more = el('details');
    more.style.marginTop = '10px';
    more.appendChild(el('summary', 'empty', 'or give a site and its feed yourself'));
    const mnm = input('name (Eurohoops)', 80), site = input('its site: https://…', 300), feed = input('its feed: https://…/feed/', 500);
    const mlogo = input('logo: https://… (optional: found on the site)', 500), colour = input('#rrggbb (optional)', 7);
    const madd = btn('Add the source', 'pri');
    madd.addEventListener('click', async () => {
      if (!webUrl(site.value) || !webUrl(feed.value)) return say('A source needs its site and its feed as web addresses.', 'err');
      if (mlogo.value.trim() && !https(mlogo.value)) return say('A logo is an https address.', 'err');
      const { error: e } = await sb.rpc('add_news_source', { p_league: lid, p_name: mnm.value, p_site_url: site.value.trim(), p_feed_url: feed.value.trim(),
        p_logo_url: mlogo.value.trim() || null, p_colour: colour.value.trim() || null });
      if (e) return say(errText(e), 'err');
      say('Added: its posts arrive with the next read (within half an hour).', 'ok');
      draw();
    });
    more.append(row(mnm, site, feed), row(mlogo, colour, madd));
    box.appendChild(more);
  }

  function editor(s) {
    const w = el('div');
    w.style.cssText = 'padding:8px 0;border-top:1px solid var(--rule)';
    const nm = input('name', 80, s.name), site = input('site', 300, s.site_url), feed = input('feed', 500, s.feed_url);
    const logo = input('logo https://… (empty: found on the site)', 500, s.logo_url || ''), colour = input('#rrggbb', 7, s.colour || '');
    const save = btn('Save', 'pri'), cancel = btn('cancel');
    save.addEventListener('click', async () => {
      const { error: e } = await sb.rpc('update_news_source', { p_id: s.id, p_name: nm.value, p_site_url: site.value.trim(), p_feed_url: feed.value.trim(),
        p_logo_url: logo.value.trim() || null, p_colour: colour.value.trim() || null, p_enabled: s.enabled });
      if (e) return say(errText(e), 'err');
      say('Saved.', 'ok');
      draw();
    });
    cancel.addEventListener('click', draw);
    w.append(row(nm, site, feed), row(logo, colour, save, cancel));
    return w;
  }
  draw();
}

return { mount, mountSources, mountForum, lookUpInvite, inviteCode, recogniseLink };
}));
