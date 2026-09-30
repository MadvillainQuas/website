'use strict';
/* ============================================================================
   THE CREATOR STUDIO — where an outlet's people write (migration 0194).

   Signed in. my_creator_outlets() is every outlet the account belongs to, by the
   email it signs in with (the league named them by it, before or after they ever
   signed in); ?o=<outlet id> opens one, and the first is opened otherwise.

     PIECES      every piece: drafts, published, hidden by the league; edit, look,
                 delete
     WRITE       one piece. An ARTICLE is written here, in the league's news format
                 (newsblocks.js: the same walk from the page to blocks, the same
                 cleaning in the database); a VIDEO, a PODCAST episode, a SOCIAL post
                 or a LINK is its address on the platform it lives on, with a caption,
                 and is shown as it will be (newscard.js: the card, and the embed)
     PAGE        the outlet's name, line, bio, logo, colour and platforms, with its
                 head drawn as it will look (owner only)
     PEOPLE      who owns and writes for it, by email (owner only)

   The database decides every one of these (upsert_creator_post, update_creator_outlet,
   add_creator_member …): a writer who is shown the page tab by mistake is refused
   there, and a suspended outlet or a league with creators off cannot publish. What is
   refused is said, in the database's words.
   ============================================================================ */
(function () {
  const K = window.EpinoiaNewsCard;
  const B = window.EpinoiaNewsBlocks;
  const $ = s => document.querySelector(s);
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const BASE = '../../';
  const KINDS = [['article', 'Article', 'written here'], ['video', 'Video', 'YouTube, TikTok, Twitch…'],
                 ['podcast', 'Podcast', 'Spotify, Apple Podcasts, SoundCloud…'], ['social', 'Social post', 'Instagram, X, TikTok, Threads…'],
                 ['link', 'Link', 'anything else of yours']];
  const PLATFORMS = [['website', 'Website'], ['youtube', 'YouTube'], ['podcast', 'Podcast'], ['spotify', 'Spotify'],
    ['apple_podcasts', 'Apple Podcasts'], ['substack', 'Substack'], ['x', 'X'], ['instagram', 'Instagram'], ['tiktok', 'TikTok'],
    ['twitch', 'Twitch'], ['threads', 'Threads'], ['bluesky', 'Bluesky'], ['facebook', 'Facebook'], ['discord', 'Discord'],
    ['patreon', 'Patreon']];
  const https = u => /^https:\/\/[^\s<>"]+$/i.test(String(u || '').trim());

  let sb = null, user = null, S = null, outletId = null, tab = 'pieces', say = () => {};

  function field(label, input, hint) {
    const w = el('label', 'st-field');
    w.appendChild(el('span', 'st-label', label));
    w.appendChild(input);
    if (hint) w.appendChild(el('span', 'st-hint', hint));
    return w;
  }
  function input(value, ph, max) {
    const i = el('input', 'ep-input');
    i.value = value || ''; if (ph) i.placeholder = ph; if (max) i.maxLength = max;
    return i;
  }
  const errText = e => (e && (e.message || e.hint || e.details)) || String(e || 'could not be saved');

  /* ------------------------------------------------------------------ boot --- */
  (async function boot() {
    const main = $('#studio');
    sb = window.epinoiaClient && window.epinoiaClient();
    const { data: { session } } = sb ? await sb.auth.getSession() : { data: { session: null } };
    main.textContent = '';
    if (!session) {
      const d = el('div', 'pc-empty');
      d.append('The creator studio is for an outlet’s owners and writers. ');
      const a = el('a', null, 'Sign in');
      a.href = BASE + 'signin/?next=' + encodeURIComponent(location.pathname + location.search);
      d.append(a, ' with the email your league gave.');
      main.appendChild(d);
      return;
    }
    user = session.user;
    const { data: mine, error } = await sb.rpc('my_creator_outlets');
    if (error) { main.appendChild(el('div', 'pc-empty', 'The studio could not be opened: ' + errText(error))); return; }
    if (!(mine || []).length) {
      main.appendChild(el('div', 'pc-empty',
        'You have no outlet yet. A league’s administrators open one for a creator and name its owner by email: ' +
        'ask yours to use ' + (user.email || 'the address you sign in with') + '.'));
      return;
    }
    const want = new URLSearchParams(location.search).get('o');
    outletId = (mine.find(m => m.outlet_id === want) || mine[0]).outlet_id;
    if (mine.length > 1) {
      const pick = el('div', 'pc-tabs st-outlets');
      mine.forEach(m => {
        const b = el('button', 'pc-tab', m.name + ' · ' + m.league_name);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(m.outlet_id === outletId));
        b.addEventListener('click', () => {
          outletId = m.outlet_id;
          pick.querySelectorAll('.pc-tab').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
          try { history.replaceState(null, '', '?o=' + encodeURIComponent(outletId)); } catch (_) { /* fine */ }
          load();
        });
        pick.appendChild(b);
      });
      main.appendChild(pick);
    }
    main.appendChild(el('div', 'st-body'));
    load();
  })();

  async function load() {
    const body = $('.st-body');
    body.textContent = '';
    body.appendChild(el('div', 'pc-empty', 'Loading…'));
    const { data, error } = await sb.rpc('creator_studio', { p_outlet: outletId });
    body.textContent = '';
    if (error) { body.appendChild(el('div', 'pc-empty', 'This outlet could not be opened: ' + errText(error))); return; }
    S = data;
    draw();
  }

  /* ------------------------------------------------------------------ draw --- */
  function draw(editing) {
    const body = $('.st-body');
    body.textContent = '';
    const o = S.outlet, lg = o.league || {};
    const runs = Array.isArray(S.members);
    const head = el('div', 'st-head');
    head.style.setProperty('--bc', /^#[0-9a-f]{6}$/i.test(o.colour || '') ? o.colour : K.tint(o.name));
    head.append(K.mark({ name: o.name, logo: o.logo_url }, 'pc-logo st-mark'));
    const words = el('div', 'st-head-w');
    words.append(el('b', null, o.name), el('span', null, lg.name + ' · ' + (S.role === 'admin' ? 'as the league' : S.role)));
    head.appendChild(words);
    const view = el('a', 'ep-btn mini', 'the page →');
    view.href = BASE + 'creators/?l=' + encodeURIComponent(lg.slug) + '&o=' + encodeURIComponent(o.slug);
    head.appendChild(view);
    body.appendChild(head);
    if (o.status === 'suspended') body.appendChild(el('div', 'st-warn', 'The league has suspended this outlet: nothing of it is shown, and nothing can be published, until the league lets it back.'));
    else if (!lg.enabled) body.appendChild(el('div', 'st-warn', lg.name + ' has creators switched off: nothing can be written or published until the league switches them on.'));

    const tabs = el('div', 'pc-tabs st-tabs');
    const T = [['pieces', 'Pieces'], ['write', editing ? 'Edit' : 'Write']].concat(runs ? [['page', 'Page'], ['people', 'People']] : []);
    T.forEach(([k, label]) => {
      const b = el('button', 'pc-tab', label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(k === tab));
      b.addEventListener('click', () => { tab = k; draw(k === 'write' ? editing : null); });
      tabs.appendChild(b);
    });
    body.appendChild(tabs);
    const msg = el('div', 'st-msg');
    msg.setAttribute('role', 'status');
    body.appendChild(msg);
    say = (t, kind) => { msg.textContent = t || ''; msg.className = 'st-msg' + (kind ? ' ' + kind : ''); };
    const pane = el('div', 'st-pane');
    body.appendChild(pane);
    if (tab === 'pieces') pieces(pane);
    else if (tab === 'write') editor(pane, editing || null);
    else if (tab === 'page' && runs) page(pane);
    else if (tab === 'people' && runs) people(pane);
    else { tab = 'pieces'; pieces(pane); }
  }

  /* ---------------------------------------------------------------- pieces --- */
  function pieces(pane) {
    const posts = S.posts || [];
    if (!posts.length) {
      pane.appendChild(el('div', 'pc-empty', 'Nothing yet. Write the first piece: an article, or a video, an episode or a post from your own platforms.'));
      return;
    }
    const list = el('div', 'st-list');
    posts.forEach(p => {
      const row = el('div', 'st-row');
      const K0 = K.KIND[p.kind] || K.KIND.article;
      row.appendChild(el('span', 'st-kind', K0.glyph + ' ' + K0.word));
      const t = el('div', 'st-row-t');
      t.appendChild(el('b', null, p.title));
      const state = p.hidden ? 'hidden by the league' : p.status === 'published' ? 'published ' + K.ago(p.published_at) : 'draft';
      t.appendChild(el('span', 'st-state' + (p.hidden ? ' bad' : p.status === 'published' ? ' ok' : ''), state));
      row.appendChild(t);
      const acts = el('div', 'st-acts');
      const ed = el('button', 'ep-btn mini', 'edit'); ed.type = 'button';
      ed.addEventListener('click', () => { tab = 'write'; draw(p); });
      acts.appendChild(ed);
      if (p.status === 'published' && !p.hidden) {
        const v = el('a', 'ep-btn mini', 'look');
        v.href = BASE + 'creators/?l=' + encodeURIComponent(S.outlet.league.slug) + '&o=' + encodeURIComponent(S.outlet.slug) + '&p=' + encodeURIComponent(p.slug);
        acts.appendChild(v);
      }
      const del = el('button', 'ep-btn mini', 'delete'); del.type = 'button';
      del.addEventListener('click', async () => {
        if (!confirm('Delete “' + p.title + '”? It cannot be brought back.')) return;
        const { error } = await sb.rpc('delete_creator_post', { p_post: p.id });
        if (error) return say(errText(error), 'bad');
        await load(); say('Deleted.', 'ok');
      });
      acts.appendChild(del);
      row.appendChild(acts);
      list.appendChild(row);
    });
    pane.appendChild(list);
  }

  /* ---------------------------------------------------------------- write --- */
  function editor(pane, p) {
    const grid = el('div', 'st-ed');
    const form = el('div', 'st-form');
    const side = el('div', 'st-side');
    grid.append(form, side);
    pane.appendChild(grid);

    const kind = el('select', 'ep-input');
    KINDS.forEach(([k, label, hint]) => { const o = el('option', null, label + ' — ' + hint); o.value = k; kind.appendChild(o); });
    kind.value = p ? p.kind : 'article';
    const title = input(p && p.title, 'Headline', 160);
    const stand = el('textarea', 'ep-input st-ta');
    stand.maxLength = 300; stand.rows = 3; stand.value = (p && p.standfirst) || '';
    const link = input(p && p.external_url, 'https://…', 500);
    const cover = input(p && p.cover_url, 'https://… (optional)', 500);
    const status = el('select', 'ep-input');
    [['draft', 'Draft — only you and your writers see it'], ['published', 'Published — on the league’s pages, and followers are told']]
      .forEach(([v, t]) => { const o = el('option', null, t); o.value = v; status.appendChild(o); });
    status.value = p ? p.status : 'draft';

    const fKind = field('Kind', kind);
    const fTitle = field('Headline', title);
    const fStand = field('Standfirst', stand);
    const fLink = field('Its address', link);
    const fCover = field('Cover picture', cover, 'an https address of a picture you host; a video’s own thumbnail is used when there is none');
    form.append(fKind, fTitle, fStand, fLink, fCover);

    /* the article's body: the league editor's toolbar and walk (admin/news-ui.js), pictures as https addresses */
    const bodyWrap = el('div', 'st-bodywrap');
    const bar = el('div', 'news-bar');
    const ed = el('div', 'news-body st-article');
    ed.contentEditable = 'true'; ed.spellcheck = true;
    ed.setAttribute('role', 'textbox'); ed.setAttribute('aria-multiline', 'true'); ed.setAttribute('aria-label', 'the article');
    const exec = (c, v) => { ed.focus(); try { document.execCommand(c, false, v); } catch (_) { /* old browser */ } };
    const cmd = (label, fn, t) => { const b = el('button', 'ep-btn mini', label); b.type = 'button'; if (t) b.title = t;
      b.addEventListener('mousedown', e => { e.preventDefault(); fn(); }); return b; };
    bar.append(cmd('B', () => exec('bold'), 'bold'), cmd('I', () => exec('italic'), 'italic'),
      cmd('H2', () => exec('formatBlock', 'H2'), 'heading'), cmd('H3', () => exec('formatBlock', 'H3'), 'sub-heading'),
      cmd('¶', () => exec('formatBlock', 'P'), 'paragraph'), cmd('“ ”', () => exec('formatBlock', 'BLOCKQUOTE'), 'quotation'),
      cmd('• list', () => exec('insertUnorderedList')), cmd('1. list', () => exec('insertOrderedList')),
      cmd('link', () => {
        const u = prompt('Address to link to (https://…)');
        if (!u) return;
        if (!/^https?:\/\//i.test(u)) return say('A link starts with https://.', 'bad');
        exec('createLink', u);
      }),
      cmd('picture', () => {
        const u = prompt('The picture’s address (https://…): a picture you host');
        if (!u) return;
        if (!https(u)) return say('A picture is an https address.', 'bad');
        const fig = document.createElement('figure');
        fig.dataset.image = u.trim();
        const img = document.createElement('img'); img.src = u.trim(); img.alt = ''; img.dataset.path = u.trim();
        const cap = document.createElement('figcaption'); cap.textContent = 'Caption';
        fig.append(img, cap);
        ed.appendChild(fig);
        ed.appendChild(document.createElement('p'));
      }, 'a picture, by its https address'),
      cmd('— rule', () => exec('insertHorizontalRule')), cmd('clear', () => exec('removeFormat')));
    if (p && Array.isArray(p.body) && p.body.length) ed.appendChild(B.toDom(p.body, { url: u => u, editable: true }));
    else ed.appendChild(document.createElement('p'));
    ed.addEventListener('paste', e => {
      e.preventDefault();
      document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
    });
    bodyWrap.append(el('span', 'st-label', 'The article'), bar, ed);
    form.appendChild(bodyWrap);
    form.appendChild(field('Status', status));

    const save = el('button', 'ep-btn pri', p ? 'Save' : 'Save the piece'); save.type = 'button';
    const cancel = el('button', 'ep-btn', 'Back to the pieces'); cancel.type = 'button';
    cancel.addEventListener('click', () => { tab = 'pieces'; draw(); });
    const row = el('div', 'st-row-btns');
    row.append(save, cancel);
    form.appendChild(row);

    /* the preview: the card as it will be, and the embed */
    side.appendChild(el('span', 'st-label', 'How it will look'));
    const prev = el('div', 'st-prev');
    side.appendChild(prev);

    function shape() {
      const k = kind.value;
      const art = k === 'article';
      fStand.querySelector('.st-label').textContent = art ? 'Standfirst — one or two lines for the card' : 'Caption';
      fLink.querySelector('.st-label').textContent = art ? 'Also on your site (optional)' : 'Its address on ' + (k === 'video' ? 'the video platform' : k === 'podcast' ? 'the podcast platform' : k === 'social' ? 'the social platform' : 'the web');
      bodyWrap.hidden = !art;
      paint();
    }
    function paint() {
      prev.textContent = '';
      const o = S.outlet;
      const e = kind.value !== 'article' ? K.embedOf(link.value.trim(), location.hostname) : null;
      const item = {
        kind: kind.value, title: title.value || 'Your headline', summary: stand.value,
        image: (https(cover.value) ? cover.value.trim() : null) || (e && e.thumb) || null, when: new Date().toISOString(),
        href: '#', platform: e ? e.label : (https(link.value) ? K.host(link.value) : null), embedUrl: e ? link.value.trim() : null,
        brand: { name: o.name, logo: o.logo_url, colour: o.colour, href: '#' }
      };
      prev.appendChild(K.card(item, { now: Date.now(), embed: !!e, host: location.hostname }));
      if (kind.value !== 'article' && link.value.trim() && !e) {
        prev.appendChild(el('p', 'st-hint', https(link.value) ? 'Not a platform Epinoia plays in place: it shows as a link card.' : 'An address starts with https://.'));
      }
    }
    kind.addEventListener('change', shape);
    [title, stand, link, cover].forEach(i => i.addEventListener('input', paint));
    shape();

    save.addEventListener('click', async () => {
      save.disabled = true;
      say('Saving…');
      const { data, error } = await sb.rpc('upsert_creator_post', {
        p_id: p ? p.id : null, p_outlet: outletId, p_kind: kind.value, p_title: title.value, p_standfirst: stand.value,
        p_body: kind.value === 'article' ? B.fromDom(ed) : [], p_cover_url: cover.value.trim() || null,
        p_external_url: link.value.trim() || null, p_status: status.value, p_slug: p ? p.slug : null
      });
      save.disabled = false;
      if (error) return say(errText(error), 'bad');
      await load();
      const again = (S.posts || []).find(x => x.id === data);
      tab = 'write';
      draw(again || null);
      say(status.value === 'published' ? 'Published: it is on the league’s pages, and followers have been told.' : 'Saved as a draft.', 'ok');
    });
  }

  /* ------------------------------------------------------------------ page --- */
  function page(pane) {
    const o = S.outlet;
    const grid = el('div', 'st-ed');
    const form = el('div', 'st-form');
    const side = el('div', 'st-side');
    grid.append(form, side);
    pane.appendChild(grid);
    const name = input(o.name, 'Name', 80);
    const tag = input(o.tagline, 'One line: what you do', 140);
    const bio = el('textarea', 'ep-input st-ta'); bio.rows = 5; bio.maxLength = 2000; bio.value = o.bio || '';
    const logo = input(o.logo_url, 'https://… a square picture of your logo', 500);
    const colour = el('input', 'st-colour'); colour.type = 'color'; colour.value = /^#[0-9a-f]{6}$/i.test(o.colour || '') ? o.colour : '#6d28d9';
    const noColour = el('input'); noColour.type = 'checkbox'; noColour.checked = !o.colour;
    const cl = el('label', 'st-inline'); cl.append(colour, noColour, el('span', null, 'no colour of my own (one is made from the name)'));
    form.append(field('Name', name), field('Line', tag), field('About', bio), field('Logo', logo, 'an https address of a square picture you host'), field('Colour', cl));
    const links = {};
    const lw = el('div', 'st-links');
    PLATFORMS.forEach(([k, label]) => { links[k] = input((o.links || {})[k], 'https://…', 300); lw.appendChild(field(label, links[k])); });
    form.appendChild(el('span', 'st-label', 'Your platforms'));
    form.appendChild(lw);
    const save = el('button', 'ep-btn pri', 'Save the page'); save.type = 'button';
    form.appendChild(save);

    side.appendChild(el('span', 'st-label', 'How it will look'));
    const prev = el('div', 'st-prev');
    side.appendChild(prev);
    function paint() {
      prev.textContent = '';
      prev.appendChild(K.hero({ name: name.value || 'Your name', logo: https(logo.value) ? logo.value.trim() : null,
        colour: noColour.checked ? null : colour.value, kicker: 'Creator · ' + (o.league && o.league.name), tagline: tag.value }));
    }
    [name, tag, logo].forEach(i => i.addEventListener('input', paint));
    colour.addEventListener('input', () => { noColour.checked = false; paint(); });
    noColour.addEventListener('change', paint);
    paint();

    save.addEventListener('click', async () => {
      const L = {};
      Object.keys(links).forEach(k => { const v = links[k].value.trim(); if (v) L[k] = v; });
      const bad = Object.keys(L).filter(k => !https(L[k]));
      if (bad.length) return say('Every platform is an https address: ' + bad.join(', ') + '.', 'bad');
      save.disabled = true;
      const { error } = await sb.rpc('update_creator_outlet', { p_outlet: outletId, p_name: name.value, p_tagline: tag.value,
        p_bio: bio.value, p_logo_url: logo.value.trim() || null, p_colour: noColour.checked ? null : colour.value, p_links: L });
      save.disabled = false;
      if (error) return say(errText(error), 'bad');
      await load(); tab = 'page'; draw(); say('Saved.', 'ok');
    });
  }

  /* ---------------------------------------------------------------- people --- */
  function people(pane) {
    const list = el('div', 'st-list');
    (S.members || []).forEach(m => {
      const row = el('div', 'st-row');
      row.append(el('span', 'st-kind', m.role), el('div', 'st-row-t', m.email));
      const rm = el('button', 'ep-btn mini', 'take off'); rm.type = 'button';
      rm.addEventListener('click', async () => {
        if (!confirm('Take ' + m.email + ' off ' + S.outlet.name + '?')) return;
        const { error } = await sb.rpc('remove_creator_member', { p_outlet: outletId, p_email: m.email });
        if (error) return say(errText(error), 'bad');
        await load(); tab = 'people'; draw(); say('Taken off.', 'ok');
      });
      const acts = el('div', 'st-acts'); acts.appendChild(rm);
      row.appendChild(acts);
      list.appendChild(row);
    });
    pane.appendChild(list);
    const add = el('div', 'st-add');
    const email = input('', 'their email', 200); email.type = 'email';
    const role = el('select', 'ep-input');
    [['writer', 'writer — publishes'], ['owner', 'owner — the page and its people too']].forEach(([v, t]) => { const o = el('option', null, t); o.value = v; role.appendChild(o); });
    const go = el('button', 'ep-btn pri', 'Add'); go.type = 'button';
    go.addEventListener('click', async () => {
      const { error } = await sb.rpc('add_creator_member', { p_outlet: outletId, p_email: email.value, p_role: role.value });
      if (error) return say(errText(error), 'bad');
      await load(); tab = 'people'; draw(); say('Added: they write here the moment they sign in with that address.', 'ok');
    });
    add.append(email, role, go);
    pane.appendChild(el('span', 'st-label', 'Add somebody, by the email they sign in with'));
    pane.appendChild(add);
  }
})();
