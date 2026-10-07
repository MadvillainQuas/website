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
                    (mountSources): on the league's news page, and every reader's News;
                    and the platform's publishers and creators the league picked (0209)

   The platform console mounts mountSources with no league: the sources every reader
   sees, the sites that cover everything (Eurohoops, BasketNews…). Each one there
   carries the leagues it covers (0207, set_news_source_leagues): every story of it on
   each one's news page (0209), and a creator's posts under Content creators on each
   one's Community page. A league's console lists the same sources (0209
   news_sources_offered) for the league to pick (set_league_news_source, its own league
   only): one list, written from both sides, and the feed read once for everybody
   rather than added again by link. It also mounts mountPartners (0201):
   every source and every outlet with an "Official partner" switch, which only the
   platform can flip (set_official_partner).

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

/* ------------------------------------------------ the league's Discord servers ---- */
/* THE LEAGUE'S DISCORD SERVERS (0197): where its fans talk, on the league's Community page (community/?l=). ANY server, the league's own or not - a fans' community, a club's: nothing here makes one.
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
        ? 'Discord servers arrive with migration 0197: it has not been applied to this database yet.'
        : 'Could not read the Discord servers: ' + errText(error)));
      return;
    }
    if (league.id !== (lg() || {}).id) return;
    box.appendChild(el('p', 'empty',
      'The Discord servers where ' + league.name + '’s fans talk, on the league’s Community page. Any server: the ' +
      'league’s own, a fans’ community, a club’s. Nothing is created here; you attach servers that exist. Paste a server’s ' +
      'invitation and its name, picture and id are read from Discord. The live widget shows once the server’s owner turns it on in ' +
      'Discord (Server Settings, Widget, Enable Server Widget).'));
    const list = Array.isArray(data) ? data : [];
    if (!list.length) box.appendChild(el('p', 'empty', 'No servers attached yet.'));
    list.forEach((x, i) => box.appendChild(line(league, x, i, list.length)));
    box.appendChild(h(list.length ? 'Attach another server' : 'Attach a server'));
    box.appendChild(editor(league, null));
    if (list.length) {
      const open = el('a', 'ep-btn mini', 'the Community page ↗');
      open.href = base + 'community/?l=' + encodeURIComponent(league.slug || '') + '#forum';
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
      if (!confirm('Take ' + x.name + ' off ' + league.name + '’s Community page? The server itself is not touched.')) return;
      const { error: e } = await sb.rpc('remove_league_discord', { p_id: x.id });
      if (e) return say(errText(e), 'err');
      say(x.name + ' is off the Community page.', 'ok');
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
      say(x ? 'Saved.' : p.name + ' is on the league’s Community page' + (p.server_id ? '.' : ' (no live widget without its server id).'), 'ok');
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
  const NR = () => globalThis.EpinoiaNewsRefresh || null;

  /* EVERY LEAGUE, for "covers" (platform console only): the console's own list when it gives one, else read here */
  async function everyLeague() {
    const given = typeof o.leagues === 'function' ? o.leagues() : o.leagues;
    if (Array.isArray(given) && given.length) return given.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const { data, error } = await sb.from('leagues').select('id,name,slug').order('name');
    return error ? [] : (data || []);
  }

  /* "LOAD ALL" (platform console only): every publisher on, read now by the news-refresh function; one control that lives
     through every redraw, so what it said stays under it while the list is drawn again with the new counts */
  let allCtl = null;
  function loadAll() {
    if (allCtl || !NR() || lg()) return allCtl;
    allCtl = NR().control({ label: 'Load all now', title: 'Read every publisher’s feed now instead of waiting for the half-hourly read',
      run: () => NR().call({ sb, all: true }), onDone: () => draw() });
    return allCtl;
  }

  async function draw() {
    const league = lg();
    const lid = league ? league.id : null;
    const [{ data, error }, leagues, offered] = await Promise.all([sb.rpc('news_sources_admin', { p_league: lid }),
      league ? Promise.resolve([]) : everyLeague().catch(() => []),
      league ? Promise.resolve(sb.rpc('news_sources_offered', { p_league: lid })).catch(e => ({ data: null, error: e })) : null]);
    box.textContent = '';
    box.appendChild(h(league ? 'Publishers & creators' : 'Publishers & creators for every reader'));
    if (error) {
      box.appendChild(el('p', 'empty', /does not exist|schema cache/i.test(errText(error))
        ? 'News sources arrive with migration 0194: it has not been applied to this database yet.'
        : 'Could not read the sources: ' + errText(error)));
      return;
    }
    box.appendChild(el('p', 'empty', (league
      ? 'News sites and creators of ' + league.name + '’s own, on the league’s news page and in every reader’s News; its creators also under Content creators on its Community page. '
      : 'What every reader sees in News; each story also lands on the news page of every league it is about (its league tags). ' +
        'Give each one the leagues it covers: every story of it on each one’s news page, and a creator’s posts under Content creators ' +
        'on its Community page too. A league’s administrators pick from this list for their own league as well. ') +
      'Paste a link: a website, a feed, a YouTube channel, a podcast, a Substack, Medium, Bluesky or Mastodon account. The feed behind ' +
      'it is found at the next read (every half hour) and every new post arrives from then on, with its followers told. A logo is found too.'));

    /* the platform's own publishers and creators, for the league to pick from (0209): made first, so that a link
       pasted below that the platform reads already can say so */
    const plat = league ? platformList(league, offered) : null;

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
      /* the platform reads it already: pick it, rather than read the same feed twice (and show every story twice in News) */
      const same = plat && plat.match(link.value);
      if (!same) return;
      said.textContent += ' ' + same.name + ' is on the platform’s list' + (same.picked
        ? ', and ' + league.name + ' has it already.' : ': pick it rather than read the same feed twice. ');
      if (same.picked) return;
      const take = btn('pick ' + same.name, 'pri');
      take.addEventListener('click', async () => {
        take.disabled = true;
        if (await plat.pick(same, true)) { link.value = ''; nm.value = ''; said.textContent = ''; add.disabled = false; }
        else take.disabled = false;
      });
      said.appendChild(take);
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
      /* A YOUTUBE CHANNEL IS FOUND AND READ AT ONCE (news-refresh, with the YouTube key): no wait for the half-hourly read,
         which GitHub can run hours late. Anything else, and a channel before the key is set, waits for that read. */
      if (NR() && d && d.slug && /(^|\.)youtube\.com\//i.test(link.value.trim().replace(/^https?:\/\//i, ''))) {
        say('Added ' + (d.name || 'it') + ': reading its channel now…', 'ok');
        const out = await NR().call({ sb, source: d.slug });
        say(out.ok ? 'Added ' + ((out.raw && out.raw.name) || d.name || 'it') + ': ' + out.text + '. Its videos are matched to games at the next half-hourly read.'
                   : 'Added ' + (d.name || 'it') + ': ' + out.text + '.', out.ok ? 'ok' : (out.kind === 'wait' ? 'ok' : 'err'));
      } else {
        say('Added ' + ((d && d.name) || 'it') + ': its feed is found at the next read (within half an hour), and its posts arrive from then on.', 'ok');
      }
      draw();
    });
    box.appendChild(row(link, kind, nm, add));
    box.appendChild(said);

    /* the button that does not wait for the half hour (needs the news-refresh function; it says so when it is not there) */
    if (NR() && !league) {
      const ctl = loadAll();
      if (ctl && (data || []).length) box.appendChild(row(ctl.box));
    }

    /* WHAT EACH YOUTUBE CHANNEL'S VIDEOS ARE FOR (0237): one read for the channels on the list; before 0237 nothing */
    const ytIds = (data || []).filter(s => s.platform === 'youtube').map(s => s.id);
    const modes = {};
    if (ytIds.length) {
      try {
        const { data: m, error: me } = await sb.rpc('news_video_modes', { p_ids: ytIds });
        if (!me) (m || []).forEach(x => { modes[x.id] = x; });
      } catch (_) { /* before 0237 */ }
    }

    /* EACH SOURCE'S TITLE FILTER (0246): one read for the list; before 0246 nothing */
    const filters = {};
    if ((data || []).length) {
      try {
        const { data: f, error: fe } = await sb.rpc('news_source_filters', { p_ids: (data || []).map(s => s.id) });
        if (!fe) (f || []).forEach(x => { filters[x.id] = x; });
      } catch (_) { /* before 0246 */ }
    }

    /* ---- the list ---- */
    if (!league && (data || []).some(s => s.assigned_leagues === undefined)) {
      box.appendChild(el('p', 'empty', 'Giving a source the leagues it covers arrives with migration 0207: it has not been applied to this database yet.'));
    }
    (data || []).forEach(s => {
      const line = el('div');
      line.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--rule)';
      const logo = logoBox(s);
      const name = el('b', null, s.name);
      const isCreator = s.kind === 'creator';
      const what = (isCreator ? 'CREATOR' : 'PUBLISHER') + (s.platform ? ' · ' + (PLATFORM_NAMES[s.platform] || s.platform) : '');
      const stateOf = x => x.resolve_from
        ? (x.last_error ? 'no feed found yet: ' + x.last_error : 'waiting for its first read, when the feed behind the link is found')
        : !x.enabled ? 'off' : x.last_error ? 'failing: ' + x.last_error : x.last_ok_at ? 'read ' + when(x.last_ok_at) : 'not read yet';
      const metaText = x => what + ' · ' + stateOf(x) + ' · ' + (x.item_count || 0) + ' posts · ' + (x.resolve_from || x.feed_url);
      const meta = el('span', 'empty', metaText(s));
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
      /* LOAD NOW: this source's feed read at once. What it says stays on the row; the counts above it are brought up to date.
         A link still waiting for its feed to be found (resolve_from) has no feed to read yet. */
      const load = NR() ? NR().control({
        label: 'Load now', title: s.resolve_from ? 'Its feed is found at the next half-hourly read' : s.enabled ? 'Read ' + s.name + '’s feed now instead of waiting for the half-hourly read' : 'Switch it on first',
        run: () => NR().call({ sb, source: s.slug }),
        onEnd: out => {
          s.last_fetched_at = new Date().toISOString();
          if (out.ok) { s.last_ok_at = s.last_fetched_at; s.last_error = null; s.item_count = out.total; }
          else if (out.raw && out.raw.last_error) s.last_error = out.raw.last_error;
          meta.textContent = metaText(s);
          meta.style.color = s.last_error && s.enabled ? 'var(--flare)' : '';
        }
      }) : null;
      if (load && (!s.enabled || s.resolve_from)) load.button.disabled = true;
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
      line.append(logo, name, meta, page, flip);
      if (load) line.appendChild(load.box);
      line.append(onoff, edit, del);
      if (!league && Array.isArray(s.assigned_leagues)) line.appendChild(covers(s, leagues));
      if (modes[s.id]) line.appendChild(videoSwitch(s, modes[s.id]));
      if (filters[s.id]) line.appendChild(titleFilter(s, filters[s.id]));
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
    if (plat) box.appendChild(plat.box);
  }

  /* A SOURCE'S TITLE FILTER (0246 set_news_source_filter): KEEP ONLY a post whose title has one of these words or
     phrases, NEVER one with any of those - a channel of many sports gives the site its basketball alone ("Betclic
     Elite"). Found as words, whatever the case and the accents; saved, the posts already read that do not fit go. */
  const quoted = l => l.map(w => '“' + w + '”');
  const filterSummary = f => ((f.title_include || []).length ? 'keep only ' + quoted(f.title_include).join(' or ') : 'every post')
    + ((f.title_exclude || []).length ? ' · never ' + quoted(f.title_exclude).join(', ') : '');
  function titleFilter(s, f) {
    const wrap = el('div');
    wrap.style.cssText = 'flex:1 1 100%;display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:2px 0 0 36px';
    const lab = el('span', 'empty', 'Titles:');
    lab.style.margin = '0';
    const sum = el('span', 'empty', filterSummary(f));
    sum.style.cssText = 'margin:0' + ((f.title_include || []).length || (f.title_exclude || []).length ? ';color:var(--ink)' : '');
    const b = btn('Filter titles');
    b.title = 'Read only the posts whose titles fit: for a channel of many sports or leagues';
    b.setAttribute('aria-expanded', 'false');
    let panel = null;
    b.addEventListener('click', () => {
      if (panel) { panel.remove(); panel = null; b.setAttribute('aria-expanded', 'false'); return; }
      panel = filterPanel(s, f, () => { sum.textContent = filterSummary(f); sum.style.color = (f.title_include.length || f.title_exclude.length) ? 'var(--ink)' : ''; });
      wrap.after(panel);
      b.setAttribute('aria-expanded', 'true');
    });
    wrap.append(lab, sum, b);
    return wrap;
  }
  function filterPanel(s, f, onSaved) {
    const p = el('div');
    p.style.cssText = 'flex:1 1 100%;margin:6px 0 4px 36px;padding:10px 12px;border:1px solid var(--rule);display:flex;flex-direction:column;gap:8px';
    const note = el('p', 'empty', 'Only the posts whose title has one of the first words are read, and never one with any of the second: '
      + 'words, not parts of words; capitals and accents do not matter. Separate them with commas. Leave the first empty to read every post.');
    note.style.margin = '0';
    const inc = input('keep only: Betclic Elite, Pro A', 600);
    inc.value = (f.title_include || []).join(', ');
    const exc = input('never: Espoirs, Pro B', 600);
    exc.value = (f.title_exclude || []).join(', ');
    inc.style.flex = exc.style.flex = '1 1 260px';
    const save = btn('Save the filter', 'pri');
    const split = v => v.split(',').map(x => x.trim()).filter(Boolean);
    save.addEventListener('click', async () => {
      save.disabled = true;
      const { data: d, error: e } = await sb.rpc('set_news_source_filter', { p_id: s.id, p_include: split(inc.value), p_exclude: split(exc.value) });
      save.disabled = false;
      if (e) return say(errText(e), 'err');
      f.title_include = (d && d.include) || [];
      f.title_exclude = (d && d.exclude) || [];
      inc.value = f.title_include.join(', ');
      exc.value = f.title_exclude.join(', ');
      const gone = (d && d.removed) || 0;
      say(s.name + ': ' + filterSummary(f) + '.' + (gone ? ' ' + gone + ' post' + (gone === 1 ? '' : 's') + ' that did not fit taken off.' : ''), 'ok');
      onSaved();
    });
    p.append(note, row(inc), row(exc, save));
    return p;
  }

  /* A YOUTUBE CHANNEL'S VIDEOS (0237 set_news_video_mode), one of three:
       Highlights   a video matched to a game is that game's highlights (the league's Video tab, the game page)
       Full games   a video matched to a game is its broadcast: the game's video, seeked to each play
       News only    its videos stay stories, on no game
     A video whose title says highlights is a game's highlights on either of the first two. */
  const VIDEO_MODES = [
    ['highlights', 'Highlights', 'Its videos of a game are that game’s highlights: on the league’s Video tab and the game page'],
    ['seeking', 'Full games', 'Its videos of a game are the whole game: the game’s video, seeked to each play (a video titled highlights stays highlights)'],
    ['off', 'News only', 'Its videos stay stories in the news and the video feed, on no game']];
  function videoSwitch(s, m) {
    const wrap = el('div');
    wrap.style.cssText = 'flex:1 1 100%;display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:2px 0 0 36px';
    const lab = el('span', 'empty', 'Videos:');
    lab.style.margin = '0';
    wrap.appendChild(lab);
    const seg = el('span');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', s.name + ': what its videos are');
    seg.style.cssText = 'display:inline-flex;gap:4px';
    let panel = null;
    VIDEO_MODES.forEach(([mode, label, tip]) => {
      const b = btn(label, m.video_mode === mode ? 'pri' : '');
      b.title = tip;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', m.video_mode === mode ? 'true' : 'false');
      b.addEventListener('click', async () => {
        if (m.video_mode === mode) return;
        const { error: e } = await sb.rpc('set_news_video_mode', { p_id: s.id, p_mode: mode });
        if (e) return say(errText(e), 'err');
        m.video_mode = mode;
        say(s.name + ': ' + label.toLowerCase() + '. ' + (mode === 'off' ? 'Its videos are put on no game from now on.'
          : 'Its videos are matched to games at the next read (within half an hour).'), 'ok');
        if (panel) panel.remove();
        wrap.replaceWith(videoSwitch(s, m));
      });
      seg.appendChild(b);
    });
    wrap.appendChild(seg);
    const n = el('span', 'empty', (m.videos || 0) + ' videos · ' + (m.matched || 0) + ' on a game');
    n.style.margin = '0';
    wrap.appendChild(n);
    /* the channel's own names for clubs, opened under the switch */
    const names = btn('Club names');
    names.title = 'The words ' + s.name + '’s titles use for clubs, and what the matcher made of its newest videos';
    names.setAttribute('aria-expanded', 'false');
    names.addEventListener('click', () => {
      if (panel) { panel.remove(); panel = null; names.setAttribute('aria-expanded', 'false'); return; }
      panel = clubNames(s);
      wrap.after(panel);
      names.setAttribute('aria-expanded', 'true');
    });
    wrap.appendChild(names);
    return wrap;
  }

  /* A CHANNEL'S OWN NAMES FOR CLUBS (0240 news_video_clubs). The video matcher finds the clubs a title names from the
     clubs' own names; a channel has its own ("Flyers", "MAN", a sponsor's name before the club's), and words that look
     like a club and are not (a venue, a presenter). A name here is read first: that club in this channel's titles, or
     no club at all. Under the names, the channel's newest videos with what the matcher made of each - the game it is
     on, or the clubs it found and where it stopped - so it is plain what to name; words selected in a title fill the
     name in. A change sends the channel's unmatched videos back to the matcher at the next read; "match again" sends
     back its last ten days, matched or not (never one linked by hand). */
  const MATCH_NOTES = {
    no_clubs: 'no club found in the title',
    one_club: 'only one club found',
    no_game: 'these clubs played no game around then',
    not_a_game: 'not a game’s video (an interview, a preview…)' };
  function clubNames(s) {
    const box = el('div');
    box.style.cssText = 'flex:1 1 100%;margin:6px 0 4px 36px;padding:10px 12px;border:1px solid var(--rule);background:var(--panel)';
    box.appendChild(el('p', 'empty', 'Loading…'));
    async function draw() {
      const { data: v, error: e } = await sb.rpc('news_video_clubs', { p_source: s.id });
      box.textContent = '';
      if (e) {
        box.appendChild(el('p', 'empty', /news_video_clubs|schema cache|does not exist/i.test(errText(e))
          ? 'Club names arrive with migration 0240: it has not been applied to this database yet.' : errText(e)));
        return;
      }
      const head = el('p', 'empty', 'The names ' + s.name + '’s titles use for clubs. The matcher reads them before the clubs’ own names: '
        + 'a name here is that club in this channel’s titles, or no club at all (a venue, a presenter, a sponsor). '
        + 'Select words in a title below to name them.');
      head.style.margin = '0 0 8px';
      box.appendChild(head);

      /* the names */
      (v.rules || []).forEach(r => {
        const line = el('div');
        line.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:3px 0';
        const to = el('span', null, r.team_id ? '→ ' + r.team + (r.league ? ' (' + r.league + ')' : '') : '→ no club');
        if (!r.team_id) to.style.color = 'var(--ink-3)';
        const x = btn('remove');
        x.addEventListener('click', async () => {
          const { error: de } = await sb.rpc('delete_news_video_club', { p_id: r.id });
          if (de) return say(errText(de), 'err');
          say('“' + r.phrase + '” is no longer a name on ' + s.name + '. Its unmatched videos are tried again at the next read.', 'ok');
          draw();
        });
        line.append(el('b', null, '“' + r.phrase + '”'), to, x);
        box.appendChild(line);
      });
      if (!(v.rules || []).length) box.appendChild(el('p', 'empty', 'No names yet: the matcher reads the clubs’ own names only.'));

      /* a new one: the words, the club (the channel's leagues' clubs, or any club found by name), or no club */
      const phrase = input('the words, as the titles write them (Flyers)', 60);
      const find = input('find a club by name…', 60);
      const pick = el('select', 'ep-input');
      pick.setAttribute('aria-label', 'the club the words mean');
      const fill = rows => {
        const keep = pick.value;
        pick.textContent = '';
        const first = el('option', null, 'the club it means…'); first.value = ''; pick.appendChild(first);
        rows.forEach(t => { const o = el('option', null, t.name + (t.league ? ' · ' + t.league : '')); o.value = t.id; pick.appendChild(o); });
        const none = el('option', null, 'no club: never read as one'); none.value = 'none'; pick.appendChild(none);
        if ([...pick.options].some(o => o.value === keep)) pick.value = keep;
      };
      const clubs = async text => {
        const { data: t } = await sb.rpc('news_video_club_teams', { p_source: s.id, p_q: text || null });
        fill(t || []);
      };
      let wait = null;
      find.addEventListener('input', () => { clearTimeout(wait); wait = setTimeout(() => clubs(find.value.trim()), 250); });
      clubs('');
      const add = btn('Add the name', 'pri');
      add.addEventListener('click', async () => {
        const p = phrase.value.trim().replace(/\s+/g, ' ');
        if (p.length < 2) return say('A name is two letters or more, as the titles write it.', 'err');
        if (!pick.value) return say('Choose the club it means, or “no club”.', 'err');
        add.disabled = true;
        const { error: ae } = await sb.rpc('set_news_video_club', { p_source: s.id, p_phrase: p, p_team: pick.value === 'none' ? null : pick.value });
        add.disabled = false;
        if (ae) return say(errText(ae), 'err');
        say('“' + p + '” is ' + (pick.value === 'none' ? 'no club' : pick.options[pick.selectedIndex].textContent) + ' on ' + s.name
          + '. Its unmatched videos are tried again at the next read (within half an hour).', 'ok');
        draw();
      });
      box.appendChild(row(phrase, find, pick, add));

      /* its newest videos, and what the matcher made of each */
      const vh = el('p', 'empty', (v.recent || []).length ? 'Its newest videos, and what the matcher made of each:' : 'No videos of it yet.');
      vh.style.margin = '12px 0 4px';
      box.appendChild(vh);
      const vids = el('div');
      vids.addEventListener('mouseup', () => {
        const t = String(window.getSelection ? window.getSelection() : '').trim().replace(/\s+/g, ' ');
        if (t && t.length <= 60) { phrase.value = t; phrase.focus(); }
      });
      (v.recent || []).forEach(it => {
        const line = el('div');
        line.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;padding:5px 0;border-top:1px dashed var(--rule)';
        const t = el('span', null, it.title || '');
        t.style.cssText = 'user-select:text;cursor:text;font-weight:600;overflow-wrap:anywhere';
        const d = el('span', 'empty', when(it.published_at));
        d.style.margin = '0';
        const st = el('span', 'empty');
        st.style.cssText = 'grid-column:1 / -1;margin:0';
        if (it.game) {
          st.textContent = '✓ on ' + it.game.home + ' v ' + it.game.away + (it.game_locked ? ' (set by hand)' : '');
          st.style.color = 'var(--lume)';
        } else if (it.game_locked) st.textContent = 'taken off its game by hand';
        else if (!it.matched_at) st.textContent = 'waiting for the matcher (the next read)';
        else {
          st.textContent = ((it.clubs || []).length ? 'found ' + it.clubs.join(' · ') + ': ' : '') + (MATCH_NOTES[it.match_note] || 'no game found');
          st.style.color = 'var(--flare)';
        }
        line.append(t, d, st);
        vids.appendChild(line);
      });
      box.appendChild(vids);

      const again = btn('Match its last ten days again');
      again.title = 'Every video of the last ten days goes back to the matcher with these names, matched or not (never one linked by hand)';
      again.addEventListener('click', async () => {
        if (!confirm('Match ' + s.name + '’s last ten days of videos again? Their highlights leave their games until the next read (within half an hour).')) return;
        const { data: c, error: re } = await sb.rpc('rematch_news_videos', { p_source: s.id });
        if (re) return say(errText(re), 'err');
        say((c || 0) + ' of ' + s.name + '’s videos go back to the matcher at the next read.', 'ok');
        draw();
      });
      box.appendChild(row(again));
    }
    draw();
    return box;
  }

  /* a source's logo, small and square */
  function logoBox(s) {
    const logo = el('span');
    logo.style.cssText = 'width:26px;height:26px;flex:none;display:grid;place-items:center;overflow:hidden;background:#fff;border:1px solid var(--rule)';
    if (s.logo_url) { const i = el('img'); i.src = s.logo_url.replace(/#fill$/, ''); i.alt = ''; i.style.cssText = 'width:90%;height:90%;object-fit:contain'; logo.appendChild(i); }
    return logo;
  }

  /* THE PLATFORM'S PUBLISHERS AND CREATORS, for a league to pick from (0209 news_sources_offered): the ones it has, each
     to take off, and the rest behind a fold, found by name or site, FIRST_PICKS at a time. A pick is for this league
     only (set_league_news_source): every story of it then joins the league's news page, and a creator's posts its
     Community page too. The source stays the platform's, its feed read once for everybody and looked after there. */
  const FIRST_PICKS = 8;
  function platformList(league, res) {
    const wrap = el('div', 'pf-list');
    wrap.style.marginTop = '18px';
    wrap.appendChild(h('From the platform’s list'));
    const nothing = { box: wrap, match: () => null, pick: async () => false };
    if (!res || res.error) {
      wrap.appendChild(el('p', 'empty', !res || /news_sources_offered|schema cache|does not exist/i.test(errText(res.error))
        ? 'Picking from the platform’s publishers and creators arrives with migration 0209: it has not been applied to this database yet.'
        : 'Could not read the platform’s list: ' + errText(res.error)));
      return nothing;
    }
    const all = (res.data || []).map(x => Object.assign({}, x, { picked: !!x.picked }));
    wrap.appendChild(el('p', 'empty', 'The publishers and creators Epinoia reads for every reader. Pick one for ' + league.name +
      ': every story of it joins the league’s news page, and a creator’s posts its Community page too. Its feed stays the ' +
      'platform’s, read once for everybody; taking it off leaves it there.'));
    const got = el('div', 'pf-got');
    const fold = el('details', 'pf-fold');
    const sum = el('summary', 'empty');
    const find = input('name or site', 80);
    find.type = 'search';
    find.setAttribute('aria-label', 'find one of the platform’s publishers and creators');
    const kinds = el('select', 'ep-input');
    [['', 'all kinds'], ['publisher', 'publishers'], ['creator', 'creators']].forEach(([v, t]) => {
      const op = el('option', null, t); op.value = v; kinds.appendChild(op);
    });
    kinds.setAttribute('aria-label', 'publishers, creators or both');
    const found = el('div', 'pf-found');
    const more = btn('');
    let many = false;                                    // past the first FIRST_PICKS
    fold.append(sum, row(find, kinds), found, more);
    wrap.append(got, fold);

    const hostOf = u => { const m = /^https?:\/\/(?:www\.|m\.)?([^/?#:]+)/i.exec(String(u || '').trim()); return m ? m[1].toLowerCase() : ''; };
    /* a link as it is compared: no scheme, no www., no query, no slash at the end */
    const keyOf = u => {
      const m = /^https?:\/\/(?:www\.|m\.)?([^/?#:]+)(?::\d+)?([^?#]*)/i.exec(String(u || '').trim());
      return m ? (m[1] + m[2].replace(/\/+$/, '')).toLowerCase() : '';
    };
    const metaOf = s => (s.kind === 'creator' ? 'CREATOR' : 'PUBLISHER') + (s.platform ? ' · ' + (PLATFORM_NAMES[s.platform] || s.platform) : '') +
      ' · ' + (!s.enabled ? 'switched off by the platform' : s.resolve_from ? 'waiting for its first read'
        : (s.item_count || 0) + ' posts' + (s.last_at ? ', the latest ' + when(s.last_at) : '')) +
      (hostOf(s.site_url) ? ' · ' + hostOf(s.site_url) : '');

    async function pick(s, on) {
      const { data: d, error: e } = await sb.rpc('set_league_news_source', { p_league: league.id, p_id: s.id, p_on: !!on });
      if (e) {
        say(/set_league_news_source|schema cache|does not exist/i.test(errText(e))
          ? 'Picking from the platform’s list arrives with migration 0209: it has not been applied to this database yet.' : errText(e), 'err');
        paint();
        return false;
      }
      s.picked = typeof d === 'boolean' ? d : !!on;
      paint();
      say(s.picked
        ? s.name + ' is on ' + league.name + '’s pages: every story of it on the league’s news page' +
          (s.kind === 'creator' ? ', and its posts under Content creators on its Community page.' : '.')
        : s.name + ' is off ' + league.name + '’s pages. It stays on the platform’s list.', 'ok');
      return true;
    }
    function line(s) {
      const r = el('div', 'pf-row');
      r.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--rule)';
      const meta = el('span', 'empty', metaOf(s));
      meta.style.cssText = 'flex:1 1 300px;margin:0;overflow-wrap:anywhere';
      const page = el('a', 'ep-btn mini', 'page'); page.href = (o.base || '../') + 'news/?s=' + encodeURIComponent(s.slug);
      const b = s.picked ? btn('take off') : btn('pick', 'pri');
      b.title = (s.picked ? 'take ' + s.name + ' off ' : 'put ' + s.name + ' on ') + league.name + '’s pages';
      b.setAttribute('aria-label', b.title);
      b.addEventListener('click', async () => { b.disabled = true; if (!(await pick(s, !s.picked))) b.disabled = false; });
      r.append(logoBox(s), el('b', null, s.name), meta, page, b);
      return r;
    }
    function paint() {
      const mine = all.filter(s => s.picked), rest = all.filter(s => !s.picked);
      got.textContent = '';
      if (!mine.length) {
        const none = el('p', 'empty', all.length ? league.name + ' has picked none of them yet.' : 'The platform reads no publishers or creators yet.');
        none.style.margin = '4px 0';
        got.appendChild(none);
      }
      mine.forEach(s => got.appendChild(line(s)));
      fold.hidden = !rest.length;                         // every one picked (or none there): nothing left to pick
      sum.textContent = 'Pick from the platform’s publishers and creators (' + rest.length + ')';
      const words = find.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const hits = rest.filter(s => (!kinds.value || s.kind === kinds.value) &&
        words.every(w => (s.name + ' ' + s.slug + ' ' + hostOf(s.site_url)).toLowerCase().indexOf(w) >= 0));
      found.textContent = '';
      if (!hits.length && rest.length) found.appendChild(el('p', 'empty', 'None of them by that.'));
      hits.slice(0, many ? hits.length : FIRST_PICKS).forEach(s => found.appendChild(line(s)));
      more.hidden = hits.length <= FIRST_PICKS;
      more.textContent = many ? 'Show fewer' : 'Show more (' + (hits.length - FIRST_PICKS) + ')';
      more.setAttribute('aria-expanded', String(many));
    }
    find.addEventListener('input', () => { many = false; paint(); });
    kinds.addEventListener('change', () => { many = false; paint(); });
    more.addEventListener('click', () => { many = !many; paint(); });
    paint();
    return {
      box: wrap,
      /* the platform's source a pasted link is (its site, its feed, or the link it was added by), or null */
      match: url => { const k = keyOf(url); return k ? all.find(s => [s.site_url, s.feed_url, s.resolve_from].some(x => x && keyOf(x) === k)) || null : null; },
      pick
    };
  }

  /* WHICH LEAGUES A SOURCE COVERS (0207; a publisher's too since 0209): a chip for each, its × to take it off, and the
     leagues it does not cover yet to add one. The whole list goes each time (set_news_source_leagues); the row is drawn
     again from what was kept. A league's own console writes the same list for its own league (set_league_news_source). */
  function covers(s, leagues) {
    const r = el('div', 'cv-row');
    r.style.cssText = 'flex:1 1 100%;display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:0 0 0 36px';
    let have = (s.assigned_leagues || []).filter(x => x && x.id).map(x => ({ id: x.id, name: x.name || '', slug: x.slug || '' }));
    async function save(next, said) {
      r.querySelectorAll('button,select').forEach(n => { n.disabled = true; });
      const { data: d, error: e } = await sb.rpc('set_news_source_leagues', { p_id: s.id, p_leagues: next.map(x => x.id) });
      if (e) {
        paint();
        return say(/set_news_source_leagues|schema cache|does not exist/i.test(errText(e))
          ? 'Giving a source its leagues arrives with migration 0207: it has not been applied to this database yet.' : errText(e), 'err');
      }
      const kept = Array.isArray(d) ? d.map(String) : next.map(x => x.id);
      have = kept.map(id => next.find(x => x.id === id)).filter(Boolean);
      s.assigned_leagues = have;
      paint();
      say(said, 'ok');
    }
    function paint() {
      r.textContent = '';
      const lab = el('span', 'empty', 'COVERS');
      lab.style.cssText = 'margin:0;font-family:var(--f-micro);font-size:9px;letter-spacing:.08em';
      r.appendChild(lab);
      if (!have.length) {
        const none = el('span', 'empty', 'no league yet: its posts are in News, and on a league’s pages only where they name it');
        none.style.margin = '0';
        r.appendChild(none);
      }
      have.forEach(x => {
        const chip = el('span', 'cv-chip');
        chip.style.cssText = 'display:inline-flex;gap:2px;align-items:center;padding:1px 2px 1px 9px;border:1px solid var(--rule-2);border-radius:999px;font-family:var(--f-ui);font-size:12px';
        chip.appendChild(el('span', null, x.name || x.slug));
        const off = btn('×');
        off.style.cssText = 'min-width:0;padding:0 6px;border:0;background:none';
        off.title = 'take ' + s.name + ' off ' + (x.name || x.slug);
        off.setAttribute('aria-label', off.title);
        off.addEventListener('click', () => save(have.filter(y => y.id !== x.id),
          s.name + ' is off ' + (x.name || x.slug) + '’s pages.'));
        chip.appendChild(off);
        r.appendChild(chip);
      });
      const left = (leagues || []).filter(l => l && l.id && !have.some(x => x.id === l.id));
      if (left.length) {
        const sel = el('select', 'ep-input cv-add');
        sel.style.cssText = 'width:auto;max-width:260px;padding:3px 6px;font-size:12px';
        const first = el('option', null, have.length ? '+ another league' : '+ a league it covers'); first.value = ''; sel.appendChild(first);
        left.forEach(l => { const op = el('option', null, l.name); op.value = l.id; sel.appendChild(op); });
        sel.setAttribute('aria-label', 'a league ' + s.name + ' covers');
        sel.addEventListener('change', () => {
          const l = left.find(x => x.id === sel.value);
          if (!l) return;
          save(have.concat([{ id: l.id, name: l.name, slug: l.slug }]), s.name + ' covers ' + l.name + (s.kind === 'creator'
            ? ': its posts show under Content creators on the league’s Community page, and on its news page.'
            : ': every story of it shows on the league’s news page.'));
        });
        r.appendChild(sel);
      }
    }
    paint();
    return r;
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

/* ------------------------------------------------------------ official partners ---- */
/* THE PLATFORM CHOOSES (0201 set_official_partner): every news source and every creator outlet, in every league, each
   with a switch. An official partner wears a small gold pill on its cards and pages, and the feed lifts its unread stories
   for about a week. Only a platform administrator can change it: the database refuses anybody else, in its own words. */
function mountPartners(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host) return;
  const sb = o.sb, say = o.say || (() => {});
  host.textContent = '';
  const box = el('div');
  host.appendChild(box);

  /* A PARTNER'S OWN WORDS AND A PUBLISHER'S OWN LOGO (0235): what its pill says, and for a news source an uploaded logo,
     whose colour is read from it (upload.js dominantColour) and becomes the publisher's colour on every card */
  function branding(r) {
    const wrap = el('div');
    wrap.style.cssText = 'flex:1 1 100%;display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding-left:2px';
    const inp = el('input'); inp.className = 'ep-input'; inp.maxLength = 32; inp.placeholder = 'Official partner';
    inp.value = r.partner_label || ''; inp.style.cssText = 'width:220px';
    inp.setAttribute('aria-label', 'What the pill says for ' + r.name);
    const save = el('button', 'ep-btn mini', 'save label'); save.type = 'button';
    save.addEventListener('click', async () => {
      save.disabled = true;
      const { error: e } = await sb.rpc('set_partner_branding', { p_kind: r.kind, p_id: r.id, p_label: inp.value.trim() || null });
      save.disabled = false;
      if (e) return say(/set_partner_branding|schema cache/i.test(errText(e)) ? 'Partner labels arrive with migration 0235: it has not been applied yet.' : errText(e), 'err');
      try { localStorage.removeItem('epinoia_feed_partners'); } catch (_) { /* nothing kept */ }
      say(r.name + '’s pill now says “' + (inp.value.trim() || 'Official partner') + '”.', 'ok');
    });
    wrap.append(el('span', 'empty', 'pill says'), inp, save);
    if (r.kind !== 'source') return wrap;
    /* the logo: a preview in the publisher's colour, and a file picker */
    const prev = el('span');
    prev.style.cssText = 'width:34px;height:34px;border-radius:50%;display:grid;place-items:center;overflow:hidden;flex:none;border:2px solid ' +
      (r.colour || 'var(--rule)') + ';background:' + (r.colour || 'transparent');
    const paint = (url, colour) => {
      prev.textContent = '';
      prev.style.borderColor = colour || 'var(--rule)'; prev.style.background = colour || 'transparent';
      if (url) { const im = el('img'); im.src = url; im.alt = ''; im.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#fff'; prev.appendChild(im); }
    };
    paint(r.logo_url, r.colour);
    const file = el('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp,image/svg+xml'; file.hidden = true;
    const pick = el('button', 'ep-btn mini', r.logo_url ? 'replace logo' : 'upload logo'); pick.type = 'button';
    pick.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      const U = window.EpinoiaUpload;
      if (!U) return say('The uploader did not load: reload the console.', 'err');
      pick.disabled = true; pick.textContent = 'uploading…';
      try {
        const out = await U.prepare(f, 'logo');
        const ext = out.type === 'image/svg+xml' ? 'svg' : out.type === 'image/webp' ? 'webp' : out.type === 'image/png' ? 'png' : 'jpg';
        const path = 'news/' + r.id + '/logo-' + Date.now().toString(36) + '.' + ext;
        const { error: ue } = await sb.storage.from('media-public').upload(path, out.main, { contentType: out.type, upsert: false });
        if (ue) throw new Error(ue.message || 'the upload was refused (is migration 0235 applied?)');
        const url = U.publicUrl(window.EPINOIA_CONFIG || {}, path);
        /* the colour read from the logo; a monochrome mark gives none, and the colour stays as it was */
        const { error: e } = await sb.rpc('set_partner_branding', { p_kind: 'source', p_id: r.id, p_label: inp.value.trim() || null,
          p_logo_url: url, p_colour: out.colour || null });
        if (e) throw new Error(errText(e));
        r.logo_url = url; if (out.colour) r.colour = out.colour;
        paint(url, r.colour);
        say(r.name + '’s logo is up' + (out.colour ? ', and its colour is now ' + out.colour + ' (read from the logo).' : '; the logo has no clear colour, so its colour was left as it was.'), 'ok');
      } catch (err) {
        say(String((err && err.message) || err), 'err');
      } finally {
        pick.disabled = false; pick.textContent = r.logo_url ? 'replace logo' : 'upload logo';
      }
    });
    wrap.append(prev, pick, file);
    return wrap;
  }

  async function draw() {
    const { data, error } = await sb.rpc('official_partners_admin');
    box.textContent = '';
    box.appendChild(h('Official partners'));
    if (error) {
      box.appendChild(el('p', 'empty', /does not exist|schema cache/i.test(errText(error))
        ? 'Official partners arrive with migration 0201: it has not been applied to this database yet.'
        : 'Could not read the official partners: ' + errText(error)));
      return;
    }
    box.appendChild(el('p', 'empty',
      'An official partner wears a small gold “Official partner” pill on its cards, its page and its stories, and the feed lifts ' +
      'its stories a reader has not opened yet, for about a week. Only the platform can name one: a league can add a source ' +
      'or open an outlet, but not call it a partner. A source that is off or an outlet that is suspended shows nothing, ' +
      'partner or not.'));
    const groups = [['News sources', 'source'], ['Creator outlets', 'outlet']];
    groups.forEach(([title, kind]) => {
      const list = (data || []).filter(r => r.kind === kind);
      box.appendChild(h(title + ' (' + list.filter(r => r.official_partner).length + ' of ' + list.length + ' are official partners)'));
      if (!list.length) box.appendChild(el('p', 'empty', kind === 'source' ? 'No news sources yet.' : 'No creator outlets yet.'));
      list.forEach(r => {
        const line = el('div', 'op-row');
        line.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--rule)';
        const sw = el('input'); sw.type = 'checkbox'; sw.className = 'sw'; sw.checked = !!r.official_partner;
        sw.setAttribute('role', 'switch'); sw.setAttribute('aria-label', 'Official partner: ' + r.name);
        const lab = el('label', 'sw-row');
        lab.style.cssText = 'display:flex;gap:8px;align-items:center;font-family:var(--f-micro);font-size:9px;letter-spacing:.08em;text-transform:uppercase;flex:none;min-width:150px';
        lab.append(sw, el('span', null, 'Official partner'));
        const name = el('b', null, r.name);
        const where = kind === 'outlet' ? (r.league_name ? r.league_name + ' · ' : '') : (r.league_name ? r.league_name + '’s own · ' : 'every reader’s · ');
        const meta = el('span', 'empty', where + (r.showing ? (kind === 'source' ? 'on' : 'active') : (kind === 'source' ? 'OFF: not shown' : 'SUSPENDED: not shown')));
        meta.style.cssText = 'flex:1 1 220px;margin:0';
        sw.addEventListener('change', async () => {
          const want = sw.checked;
          const ask = want
            ? 'Name ' + r.name + ' an official partner? Its cards and pages get the gold pill, and its unread stories are lifted in every reader’s feed for about a week.'
            : 'Stop ' + r.name + ' being an official partner? The pill and the lift go.';
          if (!confirm(ask)) { sw.checked = !want; return; }
          sw.disabled = true;
          const { error: e } = await sb.rpc('set_official_partner', { p_kind: r.kind, p_id: r.id, p_on: want });
          sw.disabled = false;
          if (e) { sw.checked = !want; return say(errText(e), 'err'); }
          /* this browser's copy of the list (feedrank.js, kept ten minutes) goes, so the pill shows here at once */
          try { localStorage.removeItem('epinoia_feed_partners'); } catch (_) { /* nothing kept */ }
          say(want ? r.name + ' is an official partner.' : r.name + ' is no longer an official partner.', 'ok');
          draw();
        });
        line.append(lab, name, meta);
        box.appendChild(line);
        line.appendChild(branding(r));
      });
    });
  }
  draw();
}

return { mount, mountSources, mountForum, lookUpInvite, inviteCode, recogniseLink, mountPartners };
}));
