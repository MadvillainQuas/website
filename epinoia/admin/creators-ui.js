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
   sees, the sites that cover everything (Eurohoops, BasketNews…). It also mounts
   mountPartners (0197): every source and every outlet with an "Official partner" switch,
   which only the platform can flip (set_official_partner).

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

/* ------------------------------------------------------------- news sources ---- */
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
    box.appendChild(h(league ? 'News sources' : 'News sources for every reader'));
    if (error) {
      box.appendChild(el('p', 'empty', /does not exist|schema cache/i.test(errText(error))
        ? 'News sources arrive with migration 0194: it has not been applied to this database yet.'
        : 'Could not read the sources: ' + errText(error)));
      return;
    }
    box.appendChild(el('p', 'empty', league
      ? 'News sites of ' + league.name + '’s own — its federation, a local paper, a club’s site — by their RSS or Atom feed. ' +
        'Read every half hour: the headline, the opening lines and the picture, each linking to the story on its own site, ' +
        'on the league’s news page and in every reader’s News. A logo is found on the site when you give none.'
      : 'The sites every reader sees in News: each story also lands on the news page of every league it is about ' +
        '(its league tags). Read every half hour; a logo is found on the site when you give none.'));
    (data || []).forEach(s => {
      const line = el('div');
      line.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--rule)';
      const logo = el('span');
      logo.style.cssText = 'width:26px;height:26px;flex:none;display:grid;place-items:center;overflow:hidden;background:#fff;border:1px solid var(--rule)';
      if (s.logo_url) { const i = el('img'); i.src = s.logo_url; i.alt = ''; i.style.cssText = 'width:90%;height:90%;object-fit:contain'; logo.appendChild(i); }
      const name = el('b', null, s.name);
      const state = !s.enabled ? 'off' : s.last_error ? 'failing: ' + s.last_error : s.last_ok_at ? 'read ' + when(s.last_ok_at) : 'not read yet';
      const meta = el('span', 'empty', state + ' · ' + (s.item_count || 0) + ' stories · ' + s.feed_url);
      meta.style.cssText = 'flex:1 1 300px;margin:0;overflow-wrap:anywhere' + (s.last_error && s.enabled ? ';color:var(--flare)' : '');
      const page = el('a', 'ep-btn mini', 'page'); page.href = (o.base || '../') + 'news/?s=' + encodeURIComponent(s.slug);
      const onoff = btn(s.enabled ? 'switch off' : 'switch on');
      onoff.addEventListener('click', async () => {
        const { error: e } = await sb.rpc('update_news_source', { p_id: s.id, p_name: s.name, p_site_url: s.site_url, p_feed_url: s.feed_url,
          p_logo_url: s.logo_url, p_colour: s.colour, p_enabled: !s.enabled });
        if (e) return say(errText(e), 'err');
        say(s.enabled ? s.name + ' is off: its stories leave the pages.' : s.name + ' is on again.', 'ok');
        draw();
      });
      const edit = btn('edit');
      edit.addEventListener('click', () => { line.replaceWith(editor(s)); });
      const del = btn('remove');
      del.addEventListener('click', async () => {
        if (!confirm('Remove ' + s.name + ' and every story of it on Epinoia?')) return;
        const { error: e } = await sb.rpc('delete_news_source', { p_id: s.id });
        if (e) return say(errText(e), 'err');
        say(s.name + ' is removed.', 'ok');
        draw();
      });
      line.append(logo, name, meta, page, onoff, edit, del);
      box.appendChild(line);
    });

    /* add one */
    const nm = input('name (Eurohoops)', 80), site = input('its site: https://…', 300), feed = input('its feed: https://…/feed/', 500);
    const logo = input('logo: https://… (optional: found on the site)', 500), colour = input('#rrggbb (optional)', 7);
    const add = btn('Add the source', 'pri');
    add.addEventListener('click', async () => {
      if (!webUrl(site.value) || !webUrl(feed.value)) return say('A source needs its site and its feed as web addresses.', 'err');
      if (logo.value.trim() && !https(logo.value)) return say('A logo is an https address.', 'err');
      const { error: e } = await sb.rpc('add_news_source', { p_league: lid, p_name: nm.value, p_site_url: site.value.trim(), p_feed_url: feed.value.trim(),
        p_logo_url: logo.value.trim() || null, p_colour: colour.value.trim() || null });
      if (e) return say(errText(e), 'err');
      say('Added: its stories arrive with the next read (within half an hour).', 'ok');
      draw();
    });
    box.appendChild(row(nm, site, feed));
    box.appendChild(row(logo, colour, add));
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
/* THE PLATFORM CHOOSES (0197 set_official_partner): every news source and every creator outlet, in every league, each
   with a switch. An official partner wears a small gold pill on its cards and pages, and the feed lifts its unread stories
   for about a week. Only a platform administrator can change it: the database refuses anybody else, in its own words. */
function mountPartners(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host) return;
  const sb = o.sb, say = o.say || (() => {});
  host.textContent = '';
  const box = el('div');
  host.appendChild(box);

  async function draw() {
    const { data, error } = await sb.rpc('official_partners_admin');
    box.textContent = '';
    box.appendChild(h('Official partners'));
    if (error) {
      box.appendChild(el('p', 'empty', /does not exist|schema cache/i.test(errText(error))
        ? 'Official partners arrive with migration 0197: it has not been applied to this database yet.'
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
          say(want ? r.name + ' is an official partner.' : r.name + ' is no longer an official partner.', 'ok');
          draw();
        });
        line.append(lab, name, meta);
        box.appendChild(line);
      });
    });
  }
  draw();
}

return { mount, mountSources, mountPartners };
}));
