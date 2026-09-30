'use strict';
/* ============================================================================
   THE WRITING DESK - the creator studio's editor (0194, and 0200: the creator hub).   window.EpinoiaCreatorEditor

   Laid out the way a newsroom's editor is, and kept simple:
     * THE TOP BAR: back to the pieces, where the piece stands (draft, saved at…, unsaved changes), Preview,
       Save draft, and one button that does what the Status panel says - Publish, Schedule or Update.
     * THE PAGE: the kind (an article, or a video, an episode, a post or a link that lives elsewhere), the
       headline, and for an article the text itself, with a toolbar that stays in reach: the block (paragraph,
       heading, subheading, quote, pull quote, lists), bold, italic, a link, a picture (uploaded, or an address),
       an embedded video or post, a rule, undo and redo. Typing "## ", "### ", "> ", '" ', "- " or "1. " at the
       start of a line makes that block, as in most editors; Ctrl/⌘ B, I, K and S do what they say. Pasting keeps
       the headings, lists, bold, italic and links of what was copied, and nothing else. Words and reading time
       as you go.
     * THE PANELS: Status (draft, publish now, or schedule for a date and time), Permalink, Featured image,
       Excerpt, Tags, Search & social (the title and description search engines and link previews show, with
       how they will look), Outline (the headings, to jump between), and Revisions (every save that changed the
       words, to look at or bring back).
     * AUTOSAVE on this device every few seconds; a newer autosave than the saved piece is offered back when
       the piece is opened again.

   The database decides everything (upsert_creator_post, 0200): what is refused is said in its words. Before
   0200 is on the server the editor still saves, without the tags, the search fields or a schedule.

     mount(host, { sb, S, outletId, piece, kind, title, say, onSaved(id, status), onBack() })   kind, title: a new piece's
     + words(text) readingMinutes(n) slugify(text) localInput(date) cleanTags(list)    (pure, for the test)
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaCreatorEditor = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const KINDS = [['article', 'Article'], ['video', 'Video'], ['podcast', 'Podcast'], ['social', 'Social post'], ['link', 'Link']];
const BLOCKS = [['p', 'Paragraph'], ['h2', 'Heading'], ['h3', 'Subheading'], ['quote', 'Quote'], ['pullquote', 'Pull quote'],
                ['ul', 'Bulleted list'], ['ol', 'Numbered list']];
/* what typed at the start of a line, then a space, makes */
const MARKS = { '##': 'h2', '###': 'h3', '>': 'quote', '"': 'pullquote', '“': 'pullquote', '-': 'ul', '*': 'ul', '1.': 'ol' };
const WPM = 230;

/* ----------------------------------------------------------------------------------- pure --- */
function words(text) { const t = String(text || '').trim(); return t ? t.split(/\s+/).length : 0; }
function readingMinutes(n) { return Math.max(1, Math.round((Number(n) || 0) / WPM)); }
/* creator_slug's rule (0194): letters and digits, the rest a hyphen, 60 at most */
function slugify(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60).replace(/^-+|-+$/g, '');
}
/* a Date as a datetime-local input's value, in the reader's own time */
function localInput(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}
/* the tags as the database will keep them (creator_tags, 0200), less its word list: shown before saving */
function cleanTags(list) {
  const seen = new Set(), out = [];
  (list || []).forEach(x => {
    const t = String(x || '').replace(/\s+/g, ' ').trim();
    if (!/^[\p{L}\p{N}][\p{L}\p{N} &'’.+#-]{0,29}$/u.test(t) || seen.has(t.toLowerCase()) || out.length >= 8) return;
    seen.add(t.toLowerCase()); out.push(t);
  });
  return out;
}

/* ------------------------------------------------------------------------------------- the page --- */
const doc = root.document;
const el = (t, c, x) => { const n = doc.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const btn = (label, cls, title) => { const b = el('button', 'ep-btn ' + (cls || ''), label); b.type = 'button'; if (title) b.title = title; return b; };
const https = u => /^https:\/\/[^\s<>"]+$/i.test(String(u || '').trim());
const errText = e => (e && (e.message || e.hint || e.details)) || String(e || 'could not be saved');
const missingNew = e => /PGRST202|Could not find the function|p_tags|p_publish_at|schedule/i.test(((e && (e.code || '')) + ' ' + errText(e)));

/* THE EDITOR ON SCREEN. The document's listeners are added once and speak to it alone, so opening piece after piece
   does not pile them up. */
let active = null, hooked = false;
function hookDoc() {
  if (hooked || !doc) return;
  hooked = true;
  doc.addEventListener('selectionchange', () => { if (active) active.onSelection(); });
  doc.addEventListener('keydown', e => { if (active) active.onKey(e); });
  root.addEventListener('beforeunload', e => { if (active && active.unsaved()) { e.preventDefault(); e.returnValue = ''; } });
}

function mount(host, o) {
  const K = root.EpinoiaNewsCard, B = root.EpinoiaNewsBlocks;
  const sb = o.sb, S = o.S, outletId = o.outletId;
  let p = o.piece || null;
  const say = o.say || (() => {});
  const lg = (S.outlet && S.outlet.league) || {};
  const draftKey = 'epinoia_draft_' + outletId + '_' + (p ? p.id : 'new');
  let dirty = false, savedAt = p ? new Date(p.updated_at) : null, busy = false;

  host.textContent = '';
  const wrap = host.appendChild(el('div', 'ce'));
  wrap.setAttribute('data-i18n-ctx', 'editor');

  /* ------------------------------------------------------------------ the top bar --- */
  const top = wrap.appendChild(el('div', 'ce-top'));
  const back = top.appendChild(btn('← All pieces', 'mini ce-back'));
  const state = top.appendChild(el('span', 'ce-state'));
  state.setAttribute('role', 'status');
  top.appendChild(el('span', 'ce-sp'));
  /* where there is no room beside the text, the settings open from here, as a newsroom editor's do */
  const setBtn = top.appendChild(btn('Settings', 'mini ce-setbtn'));
  setBtn.setAttribute('aria-expanded', 'false');
  setBtn.addEventListener('click', () => {
    const on = !wrap.classList.contains('ce-sideopen');
    wrap.classList.toggle('ce-sideopen', on);
    setBtn.setAttribute('aria-expanded', String(on));
    if (on) side.scrollIntoView({ block: 'nearest' });
  });
  const prevBtn = top.appendChild(btn('Preview', 'mini'));
  const draftBtn = top.appendChild(btn('Save draft', 'mini'));
  const goBtn = top.appendChild(btn('Publish', 'mini pri ce-go'));

  const grid = wrap.appendChild(el('div', 'ce-grid'));
  const main = grid.appendChild(el('div', 'ce-main'));
  const side = grid.appendChild(el('aside', 'ce-side'));
  side.setAttribute('aria-label', 'Settings of the piece');

  /* the autosaved version, if one is newer than the saved piece */
  const offer = main.appendChild(el('div', 'ce-offer'));
  offer.hidden = true;

  /* ------------------------------------------------------------------ the kind --- */
  let kind = p ? p.kind : (KINDS.some(k => k[0] === o.kind) ? o.kind : 'article');
  const kinds = main.appendChild(el('div', 'ce-kinds'));
  kinds.setAttribute('role', 'group'); kinds.setAttribute('aria-label', 'Kind of piece');
  KINDS.forEach(([k, label]) => {
    const b = kinds.appendChild(btn(label, 'mini'));
    b.dataset.k = k;
    b.addEventListener('click', () => { kind = k; shape(); change(); });
  });

  /* ------------------------------------------------------------------ the headline --- */
  const title = main.appendChild(el('textarea', 'ce-title'));
  title.rows = 1; title.maxLength = 160; title.placeholder = 'Add a headline';
  title.setAttribute('aria-label', 'Headline');
  title.value = (p && p.title) || (o.title ? String(o.title).slice(0, 160) : '');
  const grow = () => { title.style.height = 'auto'; title.style.height = title.scrollHeight + 'px'; };
  title.addEventListener('input', () => { grow(); change(); });
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (kind === 'article') focusBody(); } });

  /* a piece that lives elsewhere: its address, and how it will play */
  const linkWrap = main.appendChild(el('div', 'ce-linkwrap'));
  const linkLab = linkWrap.appendChild(el('label', 'ce-field'));
  const linkLabT = linkLab.appendChild(el('span', 'ce-lab', 'Its address'));
  const link = linkLab.appendChild(el('input', 'ep-input'));
  link.type = 'url'; link.placeholder = 'https://'; link.maxLength = 500; link.value = (p && p.external_url) || '';
  const linkNote = linkWrap.appendChild(el('p', 'ce-hint'));
  const linkPrev = linkWrap.appendChild(el('div', 'ce-linkprev'));
  link.addEventListener('input', () => { paintLink(); change(); });

  /* ------------------------------------------------------------------ the toolbar and the text --- */
  const bodyWrap = main.appendChild(el('div', 'ce-bodywrap'));
  const bar = bodyWrap.appendChild(el('div', 'ce-bar'));
  bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Formatting');
  const blockSel = bar.appendChild(el('select', 'ep-input ce-block'));
  blockSel.setAttribute('aria-label', 'Block');
  BLOCKS.forEach(([k, label]) => { const op = blockSel.appendChild(el('option', null, label)); op.value = k; });
  const tool = (label, title, fn, cls) => {
    const b = bar.appendChild(btn(label, 'mini ce-tool ' + (cls || ''), title));
    b.setAttribute('aria-label', title);
    b.addEventListener('mousedown', e => e.preventDefault());       // the text keeps its selection
    b.addEventListener('click', fn);
    return b;
  };
  const tBold = tool('B', 'Bold (Ctrl+B)', () => exec('bold'), 'ce-b');
  const tItal = tool('I', 'Italic (Ctrl+I)', () => exec('italic'), 'ce-i');
  tool('Link', 'Link (Ctrl+K)', () => linkDialog());
  bar.appendChild(el('span', 'ce-tsep'));
  tool('Picture', 'Add a picture', () => imageDialog());
  tool('Embed', 'Embed a video, an episode or a post', () => embedDialog());
  tool('—', 'A dividing rule', () => { exec('insertHorizontalRule'); });
  bar.appendChild(el('span', 'ce-tsep'));
  tool('↶', 'Undo (Ctrl+Z)', () => exec('undo'));
  tool('↷', 'Redo (Ctrl+Shift+Z)', () => exec('redo'));
  tool('Clear', 'Clear the formatting of the selection', () => { exec('removeFormat'); exec('unlink'); });

  const ed = bodyWrap.appendChild(el('div', 'news-body ce-body st-article'));
  ed.contentEditable = 'true'; ed.spellcheck = true;
  try { doc.execCommand('defaultParagraphSeparator', false, 'p'); } catch (_) { /* a browser that makes divs: they save as paragraphs */ }
  ed.setAttribute('role', 'textbox'); ed.setAttribute('aria-multiline', 'true'); ed.setAttribute('aria-label', 'The article');
  ed.dataset.placeholder = 'Start writing. Type ## for a heading, > for a quote, - for a list.';
  const embedNode = (url, b) => editEmbed(url, b && b.caption);
  /* blocks into the editor: an embed's caption stays typeable inside its card, a pull quote's speaker says so */
  function fill(blocks) {
    ed.textContent = '';
    if (Array.isArray(blocks) && blocks.length) ed.appendChild(B.toDom(blocks, { url: u => u, editable: true, embed: embedNode }));
    if (!ed.firstChild) ed.appendChild(el('p')).appendChild(el('br'));
    ed.querySelectorAll('figure[data-embed] figcaption').forEach(fc => { fc.contentEditable = 'true'; fc.dataset.placeholder = 'caption (optional)'; });
    ed.querySelectorAll('blockquote.pullquote cite').forEach(c => { c.dataset.placeholder = 'who said it'; });
  }
  fill(p && p.body);
  const count = bodyWrap.appendChild(el('div', 'ce-count'));

  /* ------------------------------------------------------------------ the panels --- */
  const panel = (label, open) => {
    const d = side.appendChild(el('details', 'ce-panel'));
    if (open) d.open = true;
    d.appendChild(el('summary', null, label));
    return d.appendChild(el('div', 'ce-pbody'));
  };

  /* STATUS */
  const pStatus = panel('Status', true);
  let status = p ? (p.status === 'published' ? 'published' : p.status === 'scheduled' ? 'scheduled' : 'draft') : 'draft';
  const statusWrap = pStatus.appendChild(el('div', 'ce-radios'));
  const radios = {};
  [['draft', 'Draft', 'only you and your writers see it'],
   ['published', 'Publish', 'on the league’s pages now, and followers are told'],
   ['scheduled', 'Schedule', 'out of sight until the time you choose']].forEach(([k, label, hint]) => {
    const l = statusWrap.appendChild(el('label', 'ce-radio'));
    const r = l.appendChild(el('input')); r.type = 'radio'; r.name = 'ce-status-' + outletId; r.value = k;
    const t = l.appendChild(el('span'));
    t.appendChild(el('b', null, label)); t.appendChild(el('span', 'ce-hint', hint));
    radios[k] = r;
    r.addEventListener('change', () => { status = k; paintStatus(); change(); });
  });
  const whenWrap = pStatus.appendChild(el('label', 'ce-field ce-when'));
  whenWrap.appendChild(el('span', 'ce-lab', 'Publish on'));
  const when = whenWrap.appendChild(el('input', 'ep-input'));
  when.type = 'datetime-local';
  if (p && p.status === 'scheduled' && p.published_at) when.value = localInput(new Date(p.published_at));
  when.addEventListener('input', () => { paintStatus(); change(); });
  const statusNote = pStatus.appendChild(el('p', 'ce-hint ce-snote'));

  /* PERMALINK */
  const pLink = panel('Permalink', false);
  const slugWrap = pLink.appendChild(el('label', 'ce-field'));
  slugWrap.appendChild(el('span', 'ce-lab', 'The end of its address'));
  const slug = slugWrap.appendChild(el('input', 'ep-input'));
  slug.maxLength = 60; slug.placeholder = 'made from the headline'; slug.value = (p && p.slug) || '';
  const slugUrl = pLink.appendChild(el('p', 'ce-hint ce-url'));
  slug.addEventListener('input', () => { paintSlug(); change(); });

  /* FEATURED IMAGE */
  const pCover = panel('Featured image', true);
  let cover = (p && p.cover_url) || '';
  const coverBox = pCover.appendChild(el('div', 'ce-cover'));
  const coverRow = pCover.appendChild(el('div', 'ce-row'));
  const coverUp = coverRow.appendChild(btn('Upload', 'mini'));
  const coverUrlB = coverRow.appendChild(btn('Use an address', 'mini'));
  const coverRm = coverRow.appendChild(btn('Remove', 'mini'));
  const coverFile = pCover.appendChild(el('input')); coverFile.type = 'file'; coverFile.accept = 'image/png,image/jpeg,image/webp'; coverFile.hidden = true;
  pCover.appendChild(el('p', 'ce-hint', 'Shown at the top of the piece and on its card. A video uses its own thumbnail when there is none.'));
  coverUp.addEventListener('click', () => coverFile.click());
  coverFile.addEventListener('change', async () => {
    const f = coverFile.files && coverFile.files[0]; coverFile.value = '';
    if (!f) return;
    try { say('Uploading the picture…'); cover = await upload(f, 'cover'); paintCover(); change(); say('Picture uploaded.', 'ok'); }
    catch (e) { say(errText(e), 'bad'); }
  });
  coverUrlB.addEventListener('click', () => {
    const u = root.prompt('The picture’s address (https://…)', cover || '');
    if (u == null) return;
    if (u.trim() && !https(u)) return say('A picture is an https address.', 'bad');
    cover = u.trim(); paintCover(); change();
  });
  coverRm.addEventListener('click', () => { cover = ''; paintCover(); change(); });

  /* EXCERPT */
  const pEx = panel('Excerpt', true);
  const stand = pEx.appendChild(el('textarea', 'ep-input ce-ta'));
  stand.maxLength = 300; stand.rows = 3; stand.value = (p && p.standfirst) || '';
  stand.setAttribute('aria-label', 'Excerpt');
  const standN = pEx.appendChild(el('p', 'ce-hint ce-n'));
  const standHint = pEx.appendChild(el('p', 'ce-hint'));
  stand.addEventListener('input', () => { paintCounts(); change(); });

  /* TAGS */
  const pTags = panel('Tags', false);
  let tags = cleanTags((p && p.tags) || []);
  const chips = pTags.appendChild(el('div', 'ce-chips'));
  const tagIn = pTags.appendChild(el('input', 'ep-input'));
  tagIn.placeholder = 'Add a tag, then Enter'; tagIn.maxLength = 30;
  tagIn.setAttribute('aria-label', 'Add a tag');
  pTags.appendChild(el('p', 'ce-hint', 'Eight at most: a team, a player, a competition, a subject.'));
  const addTag = () => {
    const next = cleanTags(tags.concat(tagIn.value.split(',')));
    if (next.length !== tags.length) { tags = next; paintTags(); change(); }
    tagIn.value = '';
  };
  tagIn.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
    else if (e.key === 'Backspace' && !tagIn.value && tags.length) { tags = tags.slice(0, -1); paintTags(); change(); }
  });
  tagIn.addEventListener('blur', () => { if (tagIn.value.trim()) addTag(); });

  /* SEARCH & SOCIAL */
  const pSeo = panel('Search & social', false);
  const seoTW = pSeo.appendChild(el('label', 'ce-field'));
  seoTW.appendChild(el('span', 'ce-lab', 'Title for search engines'));
  const seoT = seoTW.appendChild(el('input', 'ep-input'));
  seoT.maxLength = 70; seoT.value = (p && p.seo_title) || '';
  const seoTN = pSeo.appendChild(el('p', 'ce-hint ce-n'));
  const seoDW = pSeo.appendChild(el('label', 'ce-field'));
  seoDW.appendChild(el('span', 'ce-lab', 'Description'));
  const seoD = seoDW.appendChild(el('textarea', 'ep-input ce-ta'));
  seoD.maxLength = 160; seoD.rows = 3; seoD.value = (p && p.seo_description) || '';
  const seoDN = pSeo.appendChild(el('p', 'ce-hint ce-n'));
  pSeo.appendChild(el('span', 'ce-lab', 'In a search engine'));
  const serp = pSeo.appendChild(el('div', 'ce-serp'));
  pSeo.appendChild(el('span', 'ce-lab', 'As a card'));
  const cardPrev = pSeo.appendChild(el('div', 'ce-cardprev st-prev'));
  [seoT, seoD].forEach(i => i.addEventListener('input', () => { paintSeo(); change(); }));

  /* OUTLINE */
  const pOut = panel('Outline', false);
  const outline = pOut.appendChild(el('ol', 'ce-outline'));

  /* REVISIONS */
  const pRevD = side.appendChild(el('details', 'ce-panel'));
  pRevD.appendChild(el('summary', null, 'Revisions'));
  const pRev = pRevD.appendChild(el('div', 'ce-pbody'));
  pRevD.addEventListener('toggle', () => { if (pRevD.open) loadRevisions(); });

  /* ------------------------------------------------------------------ painting --- */
  function shape() {
    const art = kind === 'article';
    kinds.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === kind)));
    bodyWrap.hidden = !art;
    linkLabT.textContent = art ? 'Also on your site (optional)' : kind === 'video' ? 'The video’s address'
      : kind === 'podcast' ? 'The episode’s address' : kind === 'social' ? 'The post’s address' : 'The address';
    linkWrap.classList.toggle('ce-art', art);
    standHint.textContent = art ? 'One or two lines for the card and the top of the piece.' : 'The caption shown with it.';
    paintLink(); paintCounts(); paintSeo();
  }
  function paintLink() {
    linkPrev.textContent = ''; linkNote.textContent = '';
    const u = link.value.trim();
    if (!u) return;
    if (!https(u)) { linkNote.textContent = 'An address starts with https://.'; return; }
    const e = K.embedOf(u, root.location.hostname);
    if (kind !== 'article') {
      linkNote.textContent = e ? e.label + ': it plays on the page.' : 'Not a platform Epinoia plays in place: it shows as a link card.';
    }
  }
  function paintStatus() {
    Object.keys(radios).forEach(k => { radios[k].checked = k === status; });
    whenWrap.hidden = status !== 'scheduled';
    const wasOut = p && p.status === 'published';
    if (status === 'scheduled' && !when.value) when.value = localInput(new Date(Date.now() + 3600e3));
    goBtn.textContent = status === 'scheduled' ? 'Schedule' : wasOut && status === 'published' ? 'Update' : status === 'draft' ? 'Save' : 'Publish';
    draftBtn.hidden = status === 'draft';
    const at = when.value ? new Date(when.value) : null;
    statusNote.textContent = status === 'scheduled'
      ? (at && at > new Date() ? 'It goes out ' + at.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ', and its followers are told then.'
                              : 'Choose a time still to come.')
      : wasOut && p.published_at ? 'Published ' + new Date(p.published_at).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + '.'
      : '';
    if (p && p.hidden) statusNote.textContent += ' The league has hidden it.';
  }
  function paintSlug() {
    const s = slugify(slug.value) || slugify(title.value) || 'your-headline';
    slugUrl.textContent = 'creators/?l=' + (lg.slug || '…') + '&o=' + (S.outlet.slug || '…') + '&p=' + s;
  }
  function paintCover() {
    coverBox.textContent = '';
    coverRm.hidden = !cover;
    if (!cover) { coverBox.appendChild(el('div', 'ce-cover-none', 'No featured image')); return; }
    const img = coverBox.appendChild(el('img')); img.src = cover; img.alt = '';
    img.addEventListener('error', () => { coverBox.textContent = ''; coverBox.appendChild(el('div', 'ce-cover-none', 'That picture does not load.')); });
    paintSeo();
  }
  function paintTags() {
    chips.textContent = '';
    tags.forEach((t, i) => {
      const c = chips.appendChild(el('span', 'ce-chip'));
      c.appendChild(el('span', null, t)).setAttribute('translate', 'no');
      const x = c.appendChild(btn('×', 'ce-chip-x', 'Remove ' + t));
      x.addEventListener('click', () => { tags.splice(i, 1); paintTags(); change(); });
    });
  }
  function bodyText() { return kind === 'article' ? (ed.innerText || '') : ''; }
  function paintCounts() {
    ed.dataset.empty = ed.textContent.trim() || ed.querySelector('figure, hr, li') ? '' : '1';
    const n = words(bodyText());
    count.textContent = n ? n + (n === 1 ? ' word' : ' words') + ' · ' + readingMinutes(n) + ' min read' : 'No words yet';
    standN.textContent = stand.value.length + ' / 300';
  }
  function paintSeo() {
    seoTN.textContent = seoT.value.length + ' / 70' + (seoT.value ? '' : ' · the headline is used');
    seoDN.textContent = seoD.value.length + ' / 160' + (seoD.value ? '' : ' · the excerpt is used');
    serp.textContent = '';
    const t = (seoT.value || title.value || 'Your headline').slice(0, 70);
    const d = (seoD.value || stand.value || (B.excerpt ? B.excerpt(B.fromDom(ed, { extended: true }), 160) : '')).slice(0, 160);
    serp.appendChild(el('span', 'ce-serp-url', root.location.host + ' › creators › ' + (slugify(slug.value) || slugify(title.value) || '…')));
    serp.appendChild(el('span', 'ce-serp-t', t));
    serp.appendChild(el('span', 'ce-serp-d', d || 'The first lines of the piece.'));
    cardPrev.textContent = '';
    const e = kind !== 'article' ? K.embedOf(link.value.trim(), root.location.hostname) : null;
    cardPrev.appendChild(K.card({
      kind, title: title.value || 'Your headline', summary: stand.value, image: (https(cover) ? cover : null) || (e && e.thumb) || null,
      when: new Date().toISOString(), href: '#', platform: e ? e.label : null,
      brand: { name: S.outlet.name, logo: S.outlet.logo_url, colour: S.outlet.colour, href: '#' }
    }, { now: Date.now(), host: root.location.hostname }));
  }
  function paintOutline() {
    outline.textContent = '';
    const hs = [...ed.querySelectorAll('h2, h3')].filter(h => h.textContent.trim());
    if (!hs.length) { outline.appendChild(el('li', 'ce-hint', 'Headings you add appear here.')); return; }
    hs.forEach(h => {
      const li = outline.appendChild(el('li', h.tagName === 'H3' ? 'ce-o3' : 'ce-o2'));
      const a = li.appendChild(btn(h.textContent.trim().slice(0, 80), 'ce-olink'));
      a.addEventListener('click', () => { h.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    });
  }
  function paintState() {
    const t = busy ? 'Saving…' : dirty ? 'Unsaved changes'
      : savedAt ? 'Saved ' + savedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : 'Not saved yet';
    const st = p ? (p.status === 'published' ? 'Published' : p.status === 'scheduled' ? 'Scheduled' : 'Draft') : 'New';
    state.textContent = st + ' · ' + t;
    state.classList.toggle('ce-dirty', dirty);
  }

  /* ------------------------------------------------------------------ editing --- */
  function focusBody() { ed.focus(); }
  function exec(c, v) { ed.focus(); try { doc.execCommand(c, false, v); } catch (_) { /* an old browser */ } change(); }
  /* the block the caret is in: a list's item, or the element straight under the editor */
  function currentBlock() {
    const sel = root.getSelection();
    if (!sel || !sel.rangeCount || !ed.contains(sel.anchorNode)) return null;
    let n = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentNode, li = null;
    while (n && n !== ed) {
      if (n.tagName === 'LI' && !li) li = n;
      if (n.parentNode === ed) return li || n;
      n = n.parentNode;
    }
    return null;
  }
  function blockKind(b) {
    if (!b) return 'p';
    if (b.tagName === 'LI') return b.parentNode && b.parentNode.tagName === 'OL' ? 'ol' : 'ul';
    if (b.tagName === 'BLOCKQUOTE') return b.classList.contains('pullquote') ? 'pullquote' : 'quote';
    return b.tagName === 'H2' ? 'h2' : b.tagName === 'H3' ? 'h3' : 'p';
  }
  function setBlock(k) {
    const cur = blockKind(currentBlock());
    if ((cur === 'ul' || cur === 'ol') && k !== cur) exec(cur === 'ul' ? 'insertUnorderedList' : 'insertOrderedList');   // out of the list first
    if (k === 'ul' || k === 'ol') { if (cur !== k) exec(k === 'ul' ? 'insertUnorderedList' : 'insertOrderedList'); return; }
    exec('formatBlock', k === 'h2' ? 'H2' : k === 'h3' ? 'H3' : k === 'quote' || k === 'pullquote' ? 'BLOCKQUOTE' : 'P');
    const b = currentBlock();
    if (b && b.tagName === 'BLOCKQUOTE') {
      b.classList.toggle('pullquote', k === 'pullquote');
      const c = b.querySelector('cite');
      if (k === 'pullquote' && !c) { const cc = el('cite'); cc.dataset.placeholder = 'who said it'; b.appendChild(cc); }
      if (k !== 'pullquote' && c) c.remove();
    }
    change();
  }
  function paintBar() {
    const b = currentBlock();
    if (!b && root.document.activeElement !== ed) return;
    blockSel.value = blockKind(b);
    let bold = false, ital = false;
    try { bold = doc.queryCommandState('bold'); ital = doc.queryCommandState('italic'); } catch (_) { /* fine */ }
    tBold.setAttribute('aria-pressed', String(bold)); tItal.setAttribute('aria-pressed', String(ital));
  }
  blockSel.addEventListener('change', () => setBlock(blockSel.value));

  /* A LINE STARTED WITH A MARK becomes that block, empty, the caret in it. Built, not left to the browser: asked to make a
     list of an emptied paragraph, a browser puts the list inside the paragraph. */
  function caretInto(node) {
    const r = doc.createRange(); r.setStart(node, 0); r.collapse(true);
    const sel = root.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }
  function becomeEmpty(b, k) {
    let n, at;
    if (k === 'ul' || k === 'ol') { n = el(k); at = n.appendChild(el('li')); at.appendChild(el('br')); }
    else if (k === 'pullquote') {
      n = el('blockquote', 'pullquote'); at = n.appendChild(el('p')); at.appendChild(el('br'));
      n.appendChild(el('cite')).dataset.placeholder = 'who said it';
    } else { n = el(k === 'quote' ? 'blockquote' : k); at = n; n.appendChild(el('br')); }
    b.replaceWith(n);
    caretInto(at);
    change(); paintBar();
  }

  /* the caret's offset inside a block, for the typed shortcuts */
  function caretAtEnd(b) {
    const sel = root.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return false;
    const r = sel.getRangeAt(0).cloneRange();
    r.selectNodeContents(b); r.setEnd(sel.anchorNode, sel.anchorOffset);
    return r.toString().length === b.textContent.length;
  }
  ed.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); linkDialog(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(status === 'draft' ? 'draft' : 'go'); return; }
    if (e.key === ' ' && !mod && !e.altKey) {
      const b = currentBlock();
      if (!b || b.tagName === 'LI' || b.tagName === 'BLOCKQUOTE') return;
      const mark = MARKS[b.textContent.trim()];
      if (!mark || !caretAtEnd(b)) return;
      e.preventDefault();
      becomeEmpty(b, mark);
    }
  });
  ed.addEventListener('input', () => change());

  /* PASTE: what was copied, as blocks (newsblocks.js walks it: headings, lists, bold, italic, links and nothing else),
     inserted as the editor's own markup so undo still works; plain text when there is no markup */
  ed.addEventListener('paste', e => {
    const cd = e.clipboardData || root.clipboardData;
    if (!cd) return;
    e.preventDefault();
    const html = cd.getData('text/html');
    if (html && root.DOMParser) {
      const parsed = new root.DOMParser().parseFromString(html, 'text/html');
      const blocks = B.fromDom(parsed.body, { extended: true }).filter(b => b.type !== 'embed');
      if (blocks.length) {
        const box = el('div');
        box.appendChild(B.toDom(blocks, { url: u => u, editable: true }));
        box.querySelectorAll('img').forEach(i => { if (!https(i.getAttribute('src'))) i.closest('figure').remove(); });
        doc.execCommand('insertHTML', false, box.innerHTML);
        change();
        return;
      }
    }
    doc.execCommand('insertText', false, cd.getData('text/plain'));
    change();
  });
  /* a picture dropped on the text is uploaded and put where it fell */
  ed.addEventListener('drop', async e => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f || !/^image\//.test(f.type)) return;
    e.preventDefault();
    try { say('Uploading the picture…'); const u = await upload(f, 'img'); insertFigure(u, '', ''); say('Picture added.', 'ok'); }
    catch (err) { say(errText(err), 'bad'); }
  });

  /* ------------------------------------------------------------------ the dialogs --- */
  let saved = null;
  const keep = () => { const s = root.getSelection(); saved = s && s.rangeCount && ed.contains(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null; };
  const restore = () => {
    ed.focus();
    const s = root.getSelection();
    s.removeAllRanges();
    if (saved) s.addRange(saved);
    else { const r = doc.createRange(); r.selectNodeContents(ed); r.collapse(false); s.addRange(r); }
  };
  function dialog(titleText, build) {
    const d = doc.body.appendChild(el('dialog', 'ce-dlg'));
    d.setAttribute('data-i18n-ctx', 'editor');
    const f = d.appendChild(el('form', 'ce-dform'));
    f.method = 'dialog';
    f.appendChild(el('div', 'ce-dtitle', titleText));
    const acts = el('div', 'ce-dacts');
    const cancel = acts.appendChild(btn('Cancel', 'mini'));
    const okB = acts.appendChild(btn('Insert', 'mini pri'));
    okB.type = 'submit';
    const note = el('p', 'ce-hint ce-dnote');
    const done = build(f, okB, note);
    f.appendChild(note); f.appendChild(acts);
    cancel.addEventListener('click', () => d.close());
    d.addEventListener('close', () => d.remove());
    /* done() says no (false), or hands back what to do: done only once the dialog has closed, because while a modal
       dialog is open the page under it takes no focus and no selection */
    f.addEventListener('submit', async ev => {
      ev.preventDefault();
      okB.disabled = true;
      let r = false;
      try { r = await done(); }
      catch (err) { note.textContent = errText(err); note.classList.add('bad'); }
      okB.disabled = false;
      if (r === false) return;
      d.close();
      if (typeof r === 'function') r();
    });
    try { d.showModal(); } catch (_) { d.setAttribute('open', ''); }
    const first = f.querySelector('input');
    if (first) setTimeout(() => first.focus(), 30);
    return d;
  }
  const field = (host2, label, input) => { const l = host2.appendChild(el('label', 'ce-field')); l.appendChild(el('span', 'ce-lab', label)); l.appendChild(input); return input; };

  function linkDialog() {
    keep();
    const inLink = saved && saved.startContainer && (saved.startContainer.nodeType === 1 ? saved.startContainer : saved.startContainer.parentNode).closest('a');
    dialog('Link', (f, okB, note) => {
      okB.textContent = inLink ? 'Update' : 'Link';
      const u = field(f, 'The address', el('input', 'ep-input'));
      u.type = 'url'; u.placeholder = 'https://'; u.value = inLink ? inLink.getAttribute('href') : '';
      if (inLink) {
        const rm = f.appendChild(btn('Remove the link', 'mini'));
        rm.addEventListener('click', () => { rm.closest('dialog').close(); restore(); exec('unlink'); });
      }
      if (saved && saved.collapsed && !inLink) note.textContent = 'Select the words to link first, or the address itself is put in as the link.';
      return () => {
        const v = u.value.trim();
        if (!/^(https?:\/\/|mailto:)/i.test(v)) { note.textContent = 'A link starts with https://.'; return false; }
        return () => {
          restore();
          if (saved && saved.collapsed && !inLink) {
            doc.execCommand('insertText', false, v);
            const s = root.getSelection(); const r = s.getRangeAt(0);
            r.setStart(r.startContainer, Math.max(0, r.startOffset - v.length)); s.removeAllRanges(); s.addRange(r);
          }
          exec('createLink', v);
        };
      };
    });
  }
  function insertFigure(url, alt, caption) {
    const fig = el('figure');
    fig.dataset.image = url;
    const img = fig.appendChild(el('img')); img.src = url; img.alt = alt || ''; img.dataset.path = url;
    fig.appendChild(el('figcaption', null, caption || ''));
    placeBlock(fig);
  }
  /* a figure goes after the block the caret is in (never inside a paragraph), with a paragraph after it to go on in */
  function placeBlock(node) {
    restore();
    const b = currentBlock();
    let at = b;
    while (at && at.parentNode !== ed) at = at.parentNode;
    if (at && at.nextSibling) ed.insertBefore(node, at.nextSibling);
    else ed.appendChild(node);
    if (!node.nextSibling) ed.appendChild(el('p')).appendChild(el('br'));
    const r = doc.createRange(); r.setStart(node.nextSibling, 0); r.collapse(true);
    const s = root.getSelection(); s.removeAllRanges(); s.addRange(r);
    change();
  }
  function imageDialog() {
    keep();
    dialog('Picture', (f, okB, note) => {
      const file = field(f, 'Upload one', el('input', 'ep-input')); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp';
      const addr = field(f, 'Or its address', el('input', 'ep-input')); addr.type = 'url'; addr.placeholder = 'https://';
      const alt = field(f, 'Description (for screen readers)', el('input', 'ep-input')); alt.maxLength = 200;
      const cap = field(f, 'Caption (optional)', el('input', 'ep-input')); cap.maxLength = 200;
      return async () => {
        let url = addr.value.trim();
        const fl = file.files && file.files[0];
        if (fl) { note.textContent = 'Uploading…'; url = await upload(fl, 'img'); }
        if (!https(url)) { note.textContent = 'Choose a picture, or give its https address.'; return false; }
        return () => insertFigure(url, alt.value.trim(), cap.value.trim());
      };
    });
  }
  /* an embed in the editor is a card saying what will play, never the player itself (and never text to type in) */
  function editEmbed(url, caption) {
    const e = K.embedOf(url, root.location.hostname);
    const box = el('div', 'ce-embed');
    box.appendChild(el('span', 'ce-embed-k', e ? '▶ ' + e.label : '↗ Link'));
    box.appendChild(el('span', 'ce-embed-u', url)).setAttribute('translate', 'no');
    const x = box.appendChild(btn('Remove', 'mini ce-embed-x'));
    x.addEventListener('click', ev => { ev.preventDefault(); const fig = box.closest('figure'); if (fig) { fig.remove(); change(); } });
    if (caption != null) box.dataset.caption = caption;
    return box;
  }
  function embedDialog() {
    keep();
    dialog('Embed', (f, okB, note) => {
      const u = field(f, 'The address of a video, an episode or a post', el('input', 'ep-input')); u.type = 'url'; u.placeholder = 'https://';
      const cap = field(f, 'Caption (optional)', el('input', 'ep-input')); cap.maxLength = 200;
      u.addEventListener('input', () => {
        const e = https(u.value) ? K.embedOf(u.value.trim(), root.location.hostname) : null;
        note.textContent = !u.value.trim() ? '' : e ? e.label + ': it plays in the piece.' : https(u.value) ? 'Not a platform Epinoia plays: it shows as a link.' : 'An address starts with https://.';
      });
      return () => {
        const v = u.value.trim();
        if (!https(v)) { note.textContent = 'An address starts with https://.'; return false; }
        const fig = el('figure', 'art-embed');
        fig.dataset.embed = v;
        fig.contentEditable = 'false';
        fig.appendChild(editEmbed(v));
        const fc = fig.appendChild(el('figcaption', null, cap.value.trim()));
        fc.contentEditable = 'true';
        fc.dataset.placeholder = 'caption (optional)';
        return () => placeBlock(fig);
      };
    });
  }

  /* a picture of the creator's own: resized and stripped of its location in the browser (upload.js), then into the
     outlet's folder of creator-media (0200) */
  async function upload(file, what) {
    const U = root.EpinoiaUpload;
    if (!U) throw new Error('The uploader did not load.');
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) throw new Error('A PNG, JPEG or WebP picture.');
    const out = await U.prepare(file, 'gamephoto');
    const ext = out.type === 'image/webp' ? 'webp' : out.type === 'image/png' ? 'png' : 'jpg';
    const rnd = Array.from((root.crypto || {}).getRandomValues ? root.crypto.getRandomValues(new Uint8Array(10)) : [], b => (b % 36).toString(36)).join('')
      || Math.random().toString(36).slice(2, 12);
    const path = outletId + '/' + (what === 'cover' ? 'cover-' : 'img-') + rnd + '.' + ext;
    const { error } = await sb.storage.from('creator-media').upload(path, out.main, { contentType: out.type, upsert: false });
    if (error) throw new Error(/not found/i.test(error.message || '') ? 'Pictures of your own need migration 0200 on the server: give an address for now.' : errText(error));
    return sb.storage.from('creator-media').getPublicUrl(path).data.publicUrl;
  }

  /* ------------------------------------------------------------------ preview --- */
  function preview(from) {
    const v = from || current();
    const d = doc.body.appendChild(el('dialog', 'ce-dlg ce-prev'));
    d.setAttribute('data-i18n-ctx', 'editor');
    const bar2 = d.appendChild(el('div', 'ce-prevbar'));
    bar2.appendChild(el('span', 'ce-lab', from ? 'A revision' : 'Preview'));
    const close = bar2.appendChild(btn('Close', 'mini'));
    close.addEventListener('click', () => d.close());
    d.addEventListener('close', () => d.remove());
    const art = d.appendChild(el('article', 'pc-read cr-piece ce-prevbody'));
    art.appendChild(el('h1', 'ce-prev-h', v.title || 'Your headline'));
    if (v.cover && https(v.cover)) { const fig = art.appendChild(el('figure', 'pc-read-fig')); const i = fig.appendChild(el('img')); i.src = v.cover; i.alt = ''; }
    const body = art.appendChild(el('div', 'art-body cr-body'));
    if (v.stand) body.appendChild(el('p', 'art-stand', v.stand));
    body.appendChild(B.toDom(v.body || [], { url: u => u, embed: u => {
      const e = K.embedOf(u, root.location.hostname);
      if (!e) return null;
      const box = el('div', 'cr-embed cr-embed-' + e.shape);
      box.appendChild(K.embedNode(e, v.title));
      return box;
    } }));
    if (v.tags && v.tags.length) {
      const tr = art.appendChild(el('div', 'ce-prevtags'));
      v.tags.forEach(t => tr.appendChild(el('span', 'ce-chip', t)));
    }
    try { d.showModal(); } catch (_) { d.setAttribute('open', ''); }
  }

  /* ------------------------------------------------------------------ revisions --- */
  async function loadRevisions() {
    pRev.textContent = '';
    if (!p) { pRev.appendChild(el('p', 'ce-hint', 'Every save that changes the words keeps the version before it, here.')); return; }
    pRev.appendChild(el('p', 'ce-hint', 'Loading…'));
    const { data, error } = await sb.rpc('creator_post_revisions', { p_post: p.id });
    pRev.textContent = '';
    if (error) { pRev.appendChild(el('p', 'ce-hint', missingNew(error) ? 'Revisions need migration 0200 on the server.' : errText(error))); return; }
    if (!data || !data.length) { pRev.appendChild(el('p', 'ce-hint', 'None yet: every save that changes the words keeps the version before it.')); return; }
    const list = pRev.appendChild(el('ul', 'ce-revs'));
    data.forEach(r => {
      const li = list.appendChild(el('li'));
      const t = li.appendChild(el('span', 'ce-rev-t'));
      t.appendChild(el('b', null, new Date(r.saved_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })));
      t.appendChild(el('span', 'ce-hint', [r.saved_name, r.words + ' words'].filter(Boolean).join(' · ')));
      const look = li.appendChild(btn('Look', 'mini'));
      const bring = li.appendChild(btn('Restore', 'mini'));
      const get = async () => { const res = await sb.rpc('creator_post_revision', { p_id: r.id }); if (res.error) throw res.error; return res.data; };
      look.addEventListener('click', async () => {
        try { const v = await get(); preview({ title: v.title, stand: v.standfirst, body: v.body, tags: v.tags, cover }); } catch (e) { say(errText(e), 'bad'); }
      });
      bring.addEventListener('click', async () => {
        try {
          const v = await get();
          title.value = v.title; grow(); stand.value = v.standfirst || '';
          fill(v.body);
          tags = cleanTags(v.tags || []); paintTags();
          change();
          say('The version of ' + new Date(v.saved_at).toLocaleString() + ' is back in the editor: save to keep it.', 'ok');
        } catch (e) { say(errText(e), 'bad'); }
      });
    });
  }

  /* ------------------------------------------------------------------ autosave --- */
  function current() {
    return { at: new Date().toISOString(), kind, title: title.value, stand: stand.value, link: link.value, cover, tags: tags.slice(),
             seoT: seoT.value, seoD: seoD.value, slug: slug.value, body: kind === 'article' ? B.fromDom(ed, { extended: true }) : [] };
  }
  let autoT = null;
  function change() {
    dirty = true;
    paintState(); paintCounts();
    clearTimeout(autoT);
    autoT = setTimeout(() => {
      try { root.localStorage.setItem(draftKey, JSON.stringify(current())); } catch (_) { /* no room: the server copy stands */ }
      paintSeo(); paintOutline();
    }, 1500);
  }
  function offerBack() {
    let a = null;
    try { a = JSON.parse(root.localStorage.getItem(draftKey) || 'null'); } catch (_) { a = null; }
    if (!a || !a.at) return;
    const newer = !p || new Date(a.at) > new Date(p.updated_at || 0);
    if (!newer || (!a.title && !(a.body || []).length)) return;
    offer.hidden = false;
    offer.textContent = '';
    offer.appendChild(el('span', null, 'A version autosaved on this device at ' + new Date(a.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' is newer than the saved one.'));
    const yes = offer.appendChild(btn('Bring it back', 'mini pri'));
    const no = offer.appendChild(btn('Discard it', 'mini'));
    yes.addEventListener('click', () => {
      kind = a.kind || kind; title.value = a.title || ''; grow(); stand.value = a.stand || ''; link.value = a.link || ''; cover = a.cover || '';
      tags = cleanTags(a.tags || []); seoT.value = a.seoT || ''; seoD.value = a.seoD || ''; slug.value = a.slug || slug.value;
      fill(a.body);
      offer.hidden = true;
      shape(); paintTags(); paintCover(); paintSlug(); change();
    });
    no.addEventListener('click', () => { try { root.localStorage.removeItem(draftKey); } catch (_) { /* fine */ } offer.hidden = true; });
  }

  /* ------------------------------------------------------------------ saving --- */
  async function save(mode) {
    if (busy) return;
    const st = mode === 'draft' ? 'draft' : status;
    if (!title.value.trim()) { say('A piece needs a headline.', 'bad'); title.focus(); return; }
    if (st === 'draft' && p && p.status === 'published' && !root.confirm('Take it off the league’s pages? It becomes a draft again.')) return;
    let at = null;
    if (st === 'scheduled') {
      at = when.value ? new Date(when.value) : null;
      if (!at || isNaN(at) || at <= new Date()) { say('Choose a time still to come to schedule it.', 'bad'); return; }
    }
    if (kind !== 'article' && !https(link.value)) { say('A video, an episode, a post or a link needs its https address.', 'bad'); link.focus(); return; }
    busy = true; paintState(); say('Saving…');
    const args = {
      p_id: p ? p.id : null, p_outlet: outletId, p_kind: kind, p_title: title.value, p_standfirst: stand.value,
      p_body: kind === 'article' ? B.fromDom(ed, { extended: true }) : [], p_cover_url: cover || null,
      p_external_url: link.value.trim() || null, p_status: st, p_slug: slugify(slug.value) || (p ? p.slug : null),
      p_tags: tags, p_seo_title: seoT.value, p_seo_description: seoD.value, p_publish_at: at ? at.toISOString() : null
    };
    let { data, error } = await sb.rpc('upsert_creator_post', args);
    if (error && missingNew(error) && st !== 'scheduled') {
      /* a server without 0200: the piece saves without its tags, search fields and pull quotes */
      ['p_tags', 'p_seo_title', 'p_seo_description', 'p_publish_at'].forEach(k => delete args[k]);
      ({ data, error } = await sb.rpc('upsert_creator_post', args));
    }
    busy = false;
    if (error) { paintState(); say(missingNew(error) ? 'Scheduling needs migration 0200 on the server.' : errText(error), 'bad'); return; }
    dirty = false; savedAt = new Date();
    try { root.localStorage.removeItem(draftKey); root.localStorage.removeItem('epinoia_draft_' + outletId + '_new'); } catch (_) { /* fine */ }
    if (typeof o.onSaved === 'function') o.onSaved(data, st);
  }
  draftBtn.addEventListener('click', () => save('draft'));
  goBtn.addEventListener('click', () => save('go'));
  prevBtn.addEventListener('click', () => preview());
  back.addEventListener('click', () => {
    if (dirty && !root.confirm('Leave without saving? The last autosave stays on this device.')) return;
    dirty = false;
    if (typeof o.onBack === 'function') o.onBack();
  });

  /* ------------------------------------------------------------------ start --- */
  active = {
    onSelection() { const s = root.getSelection(); if (s && s.anchorNode && ed.contains(s.anchorNode)) paintBar(); },
    /* Ctrl/⌘ S anywhere in the editor, the panels included */
    onKey(e) {
      if (!wrap.isConnected || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's' || !wrap.contains(doc.activeElement) || doc.activeElement === ed) return;
      e.preventDefault(); save(status === 'draft' ? 'draft' : 'go');
    },
    unsaved() { return dirty && wrap.isConnected; }
  };
  hookDoc();
  shape(); paintStatus(); paintSlug(); paintCover(); paintTags(); paintCounts(); paintSeo(); paintOutline();
  dirty = false; paintState();
  offerBack();
  grow();
  if (!p) setTimeout(() => title.focus(), 30);
  return { save, preview, current };
}

return { mount, words, readingMinutes, slugify, localInput, cleanTags, MARKS, BLOCKS };
}));
