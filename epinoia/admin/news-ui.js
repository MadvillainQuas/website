'use strict';
/* ============================================================================
   NEWS — the writers, the list, and the editor.

   THE EDITOR IS A contenteditable WITH A TOOLBAR, which is the only way to get
   something that feels like writing rather than filling in a form. What it is
   NOT is a rich-text store: on save the DOM is walked and reduced to blocks
   (newsblocks.js), so whatever a browser or a paste from Word leaves behind
   never reaches the database and never reaches a reader.

   document.execCommand is deprecated and has no replacement that works
   everywhere. It is used here on purpose and its output is not trusted — the
   walk on save is what makes that safe. If it ever disappears the toolbar
   stops working and the stored articles are unaffected, which is the right way
   round for a deprecation to bite.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaNewsUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

function mount(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host) return;
  host.textContent = '';

  const B = window.EpinoiaNewsBlocks;
  const imgUrl = p => /^https?:\/\//.test(p || '') ? p
    : (window.EpinoiaUpload
        ? window.EpinoiaUpload.publicUrl(o.cfg, p) : p);

  let editing = null;          // the article being edited, or null for a new one

  /* ---- writers ---------------------------------------------------------- */
  host.appendChild(el('div', 'fmt-h', 'Writers'));
  host.appendChild(el('p', 'empty',
    'A writer may write, edit and publish this league’s news and nothing else. ' +
    'Administrators can already write, so they do not need adding here.'));

  const wRow = el('div', 'row');
  const wMail = el('input', 'ep-input grow');
  wMail.type = 'email'; wMail.placeholder = 'writer@club.org';
  const wGo = el('button', 'ep-btn', 'add writer'); wGo.type = 'button';
  wRow.append(wMail, wGo);
  host.appendChild(wRow);
  const wList = el('div', 'list');
  host.appendChild(wList);

  wGo.addEventListener('click', async () => {
    if (!wMail.value.trim()) return o.say('Enter an address.', 'err');
    wGo.disabled = true;
    const r = await o.sb.rpc('grant_league_writer',
      { p_league: o.league.id, p_email: wMail.value.trim() });
    wGo.disabled = false;
    if (r.error) return o.say(r.error.message, 'err');
    o.say(r.data, /^no account/.test(r.data) ? 'err' : 'ok');
    if (!/^no account/.test(r.data)) { wMail.value = ''; loadWriters(); }
  });

  async function loadWriters() {
    const r = await o.sb.rpc('league_writers_list', { p_league: o.league.id });
    wList.textContent = '';
    if (r.error) return;                       // a writer is not an admin; silent
    if (!(r.data || []).length) {
      wList.appendChild(el('div', 'empty', 'No writers appointed.'));
      return;
    }
    r.data.forEach(w => {
      const row = el('div', 'item');
      row.append(el('div', 'nm', w.email),
                 el('div', 'mt', 'since ' + new Date(w.since).toLocaleDateString()));
      const sp = el('div', 'sp');
      const rm = el('button', 'ep-btn mini', 'remove'); rm.type = 'button';
      rm.addEventListener('click', async () => {
        const r2 = await o.sb.rpc('revoke_league_writer', { p_id: w.id });
        if (r2.error) return o.say(r2.error.message, 'err');
        o.say('Removed.', 'ok'); loadWriters();
      });
      sp.appendChild(rm); row.appendChild(sp);
      wList.appendChild(row);
    });
  }

  /* ---- the article list ------------------------------------------------- */
  host.appendChild(el('div', 'fmt-h', 'Articles'));
  const newBtn = el('button', 'ep-btn pri', 'write a new article');
  newBtn.type = 'button';
  newBtn.addEventListener('click', () => openEditor(null));
  host.appendChild(el('div', 'row')).appendChild(newBtn);
  const aList = el('div', 'list');
  host.appendChild(aList);

  async function loadArticles() {
    const r = await o.sb.rpc('news_admin', { p_league: o.league.id });
    aList.textContent = '';
    if (r.error) { aList.appendChild(el('div', 'empty', r.error.message)); return; }
    if (!(r.data || []).length) {
      aList.appendChild(el('div', 'empty',
        'Nothing written yet. The first five published articles appear above the ' +
        'clubs on the league’s front page.'));
      return;
    }
    r.data.forEach(a => {
      const row = el('div', 'item');
      if (a.status === 'published') row.classList.add('on');
      const bits = [a.status];
      if (a.pinned) bits.push('pinned');
      if (a.published_at) bits.push(new Date(a.published_at).toLocaleDateString());
      if (a.author_name) bits.push('by ' + a.author_name);
      row.append(el('div', 'nm', a.title), el('div', 'mt', bits.join(' · ')));
      const sp = el('div', 'sp');

      /* PINNING IS ONE CLICK, not a trip through the editor.

         It used to be a checkbox inside the article form, so releasing a pin
         meant opening a piece you did not want to change and saving the whole
         of it back — which also overwrites whatever a co-writer edited while
         you had it open. This flips the one field.

         Only a published article can lead the page, so a draft does not offer
         it; and pinning is exclusive, so the label says what will happen to
         whatever is pinned now. */
      if (a.status === 'published') {
        const pinBtn = el('button', 'ep-btn mini', a.pinned ? 'unpin' : 'pin');
        pinBtn.type = 'button';
        pinBtn.title = a.pinned
          ? 'Stop holding this at the front — the newest article leads again'
          : 'Hold this at the front of the news, ahead of newer articles';
        if (a.pinned) pinBtn.classList.add('on');
        pinBtn.addEventListener('click', async () => {
          pinBtn.disabled = true;
          const r2 = await o.sb.rpc('set_article_pinned',
                                    { p_id: a.id, p_pinned: !a.pinned });
          pinBtn.disabled = false;
          if (r2.error) return o.say(r2.error.message, 'err');
          o.say(a.pinned
            ? 'Released — the newest article leads again.'
            : 'Pinned — it leads the news until you release it. Anything else ' +
              'that was pinned has been released.', 'ok');
          loadArticles();
        });
        sp.appendChild(pinBtn);
      }

      const ed = el('button', 'ep-btn mini', 'edit'); ed.type = 'button';
      ed.addEventListener('click', () => openEditor(a));
      const del = el('button', 'ep-btn mini', '×'); del.type = 'button';
      del.title = 'delete';
      del.addEventListener('click', async () => {
        if (!confirm('Delete “' + a.title + '”?')) return;
        const r2 = await o.sb.rpc('delete_article', { p_id: a.id });
        if (r2.error) return o.say(r2.error.message, 'err');
        o.say('Deleted.', 'ok'); loadArticles();
      });
      sp.append(ed, del); row.appendChild(sp);
      aList.appendChild(row);
    });
  }

  /* ---- the editor ------------------------------------------------------- */
  const edWrap = el('div', 'news-ed hide');
  host.appendChild(edWrap);

  function openEditor(a) {
    editing = a;
    edWrap.classList.remove('hide');
    edWrap.textContent = '';

    const head = el('div', 'row');
    const title = el('input', 'ep-input grow');
    title.placeholder = 'Headline'; title.maxLength = 200;
    title.value = a ? a.title : '';
    head.appendChild(title);
    edWrap.appendChild(head);

    const sfRow = el('div', 'row');
    const sf = el('input', 'ep-input grow');
    sf.placeholder = 'One line for the card (optional — the opening words are used if blank)';
    sf.maxLength = 400;
    sf.value = a ? a.standfirst : '';
    sfRow.appendChild(sf);
    edWrap.appendChild(sfRow);

    /* ---- cover ---- */
    const covRow = el('div', 'row');
    const cover = el('input', 'ep-input grow');
    cover.placeholder = 'Cover image — upload, or paste an https address';
    cover.value = a ? (a.cover_path || '') : '';
    const covFile = el('input'); covFile.type = 'file'; covFile.accept = 'image/*';
    covFile.style.display = 'none';
    const covBtn = el('button', 'ep-btn mini', 'upload cover'); covBtn.type = 'button';
    covBtn.addEventListener('click', () => covFile.click());
    covRow.append(cover, covBtn, covFile);
    edWrap.appendChild(covRow);
    const covPrev = el('div', 'news-cover');
    edWrap.appendChild(covPrev);
    drawCover();

    function drawCover() {
      covPrev.textContent = '';
      if (!cover.value) return;
      const img = el('img'); img.src = imgUrl(cover.value); img.alt = '';
      covPrev.appendChild(img);
    }
    cover.addEventListener('change', drawCover);
    covFile.addEventListener('change', () => upload(covFile, url => {
      cover.value = url; drawCover();
    }));

    /* ---- toolbar ---- */
    const bar = el('div', 'news-bar');
    const cmd = (label, fn, title) => {
      const b = el('button', 'ep-btn mini', label);
      b.type = 'button'; if (title) b.title = title;
      /* mousedown, not click: a click has already moved focus out of the
         editor by the time it fires, and the selection goes with it. */
      b.addEventListener('mousedown', e => { e.preventDefault(); fn(); });
      return b;
    };
    const exec = (c, v) => { body.focus(); try { document.execCommand(c, false, v); } catch (_) {} };
    bar.append(
      cmd('B', () => exec('bold'), 'bold'),
      cmd('I', () => exec('italic'), 'italic'),
      cmd('H2', () => exec('formatBlock', 'H2'), 'heading'),
      cmd('H3', () => exec('formatBlock', 'H3'), 'sub-heading'),
      cmd('¶', () => exec('formatBlock', 'P'), 'ordinary paragraph'),
      cmd('“ ”', () => exec('formatBlock', 'BLOCKQUOTE'), 'quotation'),
      cmd('• list', () => exec('insertUnorderedList')),
      cmd('1. list', () => exec('insertOrderedList')),
      cmd('link', () => {
        const u = prompt('Address to link to (https://…)');
        if (!u) return;
        if (!/^https?:\/\//i.test(u) && !/^mailto:/i.test(u)) {
          return o.say('A link has to start with https:// or mailto:.', 'err');
        }
        exec('createLink', u);
      }),
      cmd('unlink', () => exec('unlink')),
      cmd('— rule', () => exec('insertHorizontalRule')),
      cmd('image', () => imgFile.click(), 'place a picture in the article'),
      cmd('clear', () => exec('removeFormat'), 'strip formatting from the selection')
    );
    edWrap.appendChild(bar);

    const imgFile = el('input'); imgFile.type = 'file'; imgFile.accept = 'image/*';
    imgFile.style.display = 'none';
    edWrap.appendChild(imgFile);
    imgFile.addEventListener('change', () => upload(imgFile, path => {
      const fig = document.createElement('figure');
      fig.dataset.image = path;
      const img = document.createElement('img');
      img.src = imgUrl(path); img.alt = ''; img.dataset.path = path;
      fig.appendChild(img);
      const cap = document.createElement('figcaption');
      cap.textContent = 'Caption';
      fig.appendChild(cap);
      body.appendChild(fig);
      body.appendChild(document.createElement('p'));
    }));

    /* ---- the body ---- */
    const body = el('div', 'news-body');
    body.contentEditable = 'true';
    body.spellcheck = true;
    body.setAttribute('role', 'textbox');
    body.setAttribute('aria-multiline', 'true');
    if (a && a.body && a.body.length) {
      body.appendChild(B.toDom(a.body, { url: imgUrl, editable: true }));
    } else {
      body.appendChild(document.createElement('p'));
    }
    edWrap.appendChild(body);

    /* PASTE ARRIVES AS PLAIN TEXT. Everything pasted would be walked away on
       save anyway, and a writer watching Word's fonts appear and then vanish
       an hour later has been misled by the editor. */
    body.addEventListener('paste', e => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });

    /* ---- save ---- */
    const foot = el('div', 'row');
    const status = el('select', 'ep-input'); status.style.flex = '0 0 auto';
    [['draft', 'draft — only writers see it'],
     ['published', 'published — live on the league page']].forEach(p => {
      const opt = document.createElement('option'); opt.value = p[0]; opt.textContent = p[1];
      status.appendChild(opt);
    });
    status.value = a ? a.status : 'draft';
    const pin = el('input'); pin.type = 'checkbox'; pin.checked = a ? !!a.pinned : false;
    const pinLab = el('label', 'sw');
    /* Says what it costs: pinning is exclusive, so this releases whatever the
       league is currently leading with. */
    pinLab.append(pin, document.createTextNode(' lead the news with this (releases any other pin)'));
    const save = el('button', 'ep-btn pri', 'save'); save.type = 'button';
    const cancel = el('button', 'ep-btn mini', 'close'); cancel.type = 'button';
    cancel.addEventListener('click', () => { edWrap.classList.add('hide'); editing = null; });
    foot.append(status, pinLab, save, cancel);
    edWrap.appendChild(foot);

    save.addEventListener('click', async () => {
      if (!title.value.trim()) return o.say('An article needs a headline.', 'err');
      save.disabled = true;
      const blocks = B.fromDom(body);
      const r = await o.sb.rpc('upsert_article', {
        p_id: editing ? editing.id : null,
        p_league: o.league.id,
        p_title: title.value,
        p_standfirst: sf.value || B.excerpt(blocks, 200),
        p_body: blocks,
        p_cover: cover.value,
        p_status: status.value,
        p_pinned: pin.checked,
        p_slug: null
      });
      save.disabled = false;
      if (r.error) return o.say(r.error.message, 'err');
      o.say(status.value === 'published'
        ? 'Published — it is on the league page now.' : 'Saved as a draft.', 'ok');
      edWrap.classList.add('hide'); editing = null;
      loadArticles();
    });
  }

  /* Uploads go through the same pipeline as every other picture: resized in
     the browser, held privately, published once the league approves it. An
     article image therefore appears for the writer straight away and for
     readers after approval, which is worth saying rather than leaving them to
     wonder. */
  async function upload(input, done) {
    const f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    if (!window.EpinoiaUpload) return o.say('The uploader did not load.', 'err');
    try {
      const up = await window.EpinoiaUpload.upload(o.sb, {
        file: f, ownerType: 'league', ownerId: o.league.id, kind: 'news' });
      if (!up || !up.storage_path) throw new Error('the upload returned no path');
      done(up.storage_path);
      o.say('Image uploaded — it appears publicly once approved.', 'ok');
    } catch (e) {
      o.say('Upload failed: ' + (e.message || e), 'err');
    }
  }

  loadWriters();
  loadArticles();
}

return { mount };
}));
