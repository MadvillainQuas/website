'use strict';
/* ============================================================================
   ARTICLE BLOCKS — the one place that converts between an editor and storage.

   An article body is an array of blocks, never markup (migration 0051). This
   file is both directions of that conversion, and it is deliberately ONE file
   shared by the editor and the reader: two implementations of a format are two
   implementations that drift, and the failure mode of drift here is an article
   that reads correctly to the person who wrote it and not to anybody else.

     fromDom(root)   walk a contenteditable and emit blocks. Anything not on
                     the allow-list is reduced to its text or dropped. This is
                     what makes a paste from Word safe: the markup never
                     survives the walk, so there is nothing to sanitise later.

     toDom(blocks)   build real elements with createElement and textContent.
                     Nothing is ever parsed as HTML, which is why the CI guard
                     forbidding user text in innerHTML keeps holding and why
                     there is no XSS surface to defend rather than a defence to
                     keep correct.

   The database applies the SAME allow-list again on write (clean_news_body).
   That is not redundancy for its own sake: this file protects the reader from
   a careless editor, and the database protects the reader from a browser that
   never ran this file at all.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaNewsBlocks = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const BLOCK_FOR = {
  P: 'p', DIV: 'p', H1: 'h2', H2: 'h2', H3: 'h3', H4: 'h3',
  BLOCKQUOTE: 'quote', UL: 'ul', OL: 'ol', HR: 'rule', FIGURE: 'image'
};

const safeHref = h => /^https?:\/\//i.test(h || '') || /^mailto:/i.test(h || '') ? h : null;

/* CONTRIBUTE NOTHING, not even their text.

   The fallback for an unrecognised element is "keep the words, lose the
   markup", which is right for a <div> or a <table> and badly wrong for a
   <script>: its words are source code, so a paste from a web page dropped
   `window.__pwned=1` into the article as a paragraph. It could never EXECUTE —
   nothing here is ever parsed as markup — but an article carrying somebody
   else's JavaScript as prose is not a thing to publish. Found by a round-trip
   test rather than by reading the code, which is the argument for having one. */
const DROP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT',
  'EMBED', 'CANVAS', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'SELECT',
  'TEXTAREA', 'OPTION', 'LINK', 'META', 'BASE', 'TITLE', 'HEAD']);

/* ------------------------------------------------------------- DOM → blocks --- */
function fromDom(root) {
  const out = [];
  if (!root) return out;

  [...root.childNodes].forEach(node => {
    if (node.nodeType === 3) {
      /* Loose text directly under the editor — what a browser leaves behind
         after certain edits. It is a paragraph rather than nothing. */
      const t = node.textContent.trim();
      if (t) out.push({ type: 'p', spans: [{ t }] });
      return;
    }
    if (node.nodeType !== 1) return;

    const tag = node.tagName;
    if (DROP.has(tag)) return;
    const type = BLOCK_FOR[tag];

    if (tag === 'HR') { out.push({ type: 'rule' }); return; }

    if (tag === 'FIGURE' || (tag === 'DIV' && node.dataset && node.dataset.image)) {
      const img = node.querySelector('img');
      const path = (node.dataset && node.dataset.image) || (img && img.dataset && img.dataset.path);
      if (path) {
        const cap = node.querySelector('figcaption');
        out.push({ type: 'image', path,
                   caption: cap ? cap.textContent.trim().slice(0, 200) : '' });
      }
      return;
    }

    if (tag === 'UL' || tag === 'OL') {
      const items = [...node.querySelectorAll(':scope > li')]
        .map(li => spansOf(li)).filter(s => s.length);
      if (items.length) out.push({ type: tag === 'UL' ? 'ul' : 'ol', items });
      return;
    }

    if (type) {
      const spans = spansOf(node);
      if (spans.length) out.push({ type, spans });
      return;
    }

    /* An unrecognised element still had words in it. Keeping them as a
       paragraph loses the formatting and not the sentence, which is the right
       way round — a writer can re-apply bold, they cannot re-type a
       paragraph they did not notice vanish. */
    const t = node.textContent.trim();
    if (t) out.push({ type: 'p', spans: [{ t }] });
  });

  return out;
}

/* Inline runs, flattened. Nesting is not preserved beyond bold/italic/link
   because nothing downstream renders it and a nested structure that renders
   flat is a lie about what was stored. */
function spansOf(node) {
  const spans = [];
  walk(node, { b: false, i: false, href: null });
  return merge(spans);

  function walk(n, marks) {
    [...n.childNodes].forEach(c => {
      if (c.nodeType === 3) {
        if (c.textContent) spans.push(Object.assign({ t: c.textContent }, live(marks)));
        return;
      }
      if (c.nodeType !== 1) return;
      if (DROP.has(c.tagName)) return;      // a <script> nested inside a paragraph
      if (c.tagName === 'BR') { spans.push({ t: '\n' }); return; }
      const next = {
        b: marks.b || c.tagName === 'B' || c.tagName === 'STRONG' ||
           (c.style && (c.style.fontWeight === 'bold' || +c.style.fontWeight >= 600)),
        i: marks.i || c.tagName === 'I' || c.tagName === 'EM' ||
           (c.style && c.style.fontStyle === 'italic'),
        href: c.tagName === 'A' ? safeHref(c.getAttribute('href')) : marks.href
      };
      walk(c, next);
    });
  }
  function live(m) {
    const o = {};
    if (m.b) o.b = true;
    if (m.i) o.i = true;
    if (m.href) o.href = m.href;
    return o;
  }
  /* Adjacent runs with identical marks become one. A contenteditable produces
     a span boundary at every keystroke boundary, and storing forty spans for
     one sentence makes every later diff unreadable. */
  function merge(list) {
    const out = [];
    list.forEach(s => {
      const p = out[out.length - 1];
      if (p && !!p.b === !!s.b && !!p.i === !!s.i && (p.href || null) === (s.href || null)) {
        p.t += s.t;
      } else out.push(Object.assign({}, s));
    });
    return out.filter(s => s.t !== '');
  }
}

/* ------------------------------------------------------------- blocks → DOM --- */
/* opts: { url(path) -> absolute address for an image, editable: bool } */
function toDom(blocks, opts) {
  const o = opts || {};
  const frag = document.createDocumentFragment();
  (blocks || []).forEach(b => {
    if (!b || !b.type) return;
    switch (b.type) {
      case 'p': case 'h2': case 'h3': case 'quote': {
        const tag = b.type === 'p' ? 'p'
                  : b.type === 'quote' ? 'blockquote' : b.type;
        const el = document.createElement(tag);
        spansToDom(b.spans, el);
        frag.appendChild(el);
        break;
      }
      case 'ul': case 'ol': {
        const list = document.createElement(b.type);
        (b.items || []).forEach(spans => {
          const li = document.createElement('li');
          spansToDom(spans, li);
          list.appendChild(li);
        });
        frag.appendChild(list);
        break;
      }
      case 'image': {
        const fig = document.createElement('figure');
        if (o.editable) fig.dataset.image = b.path;
        const img = document.createElement('img');
        img.src = o.url ? o.url(b.path) : b.path;
        img.alt = b.caption || '';
        img.loading = 'lazy';
        img.dataset.path = b.path;
        fig.appendChild(img);
        if (b.caption) {
          const cap = document.createElement('figcaption');
          cap.textContent = b.caption;
          fig.appendChild(cap);
        }
        frag.appendChild(fig);
        break;
      }
      case 'rule':
        frag.appendChild(document.createElement('hr'));
        break;
    }
  });
  return frag;
}

function spansToDom(spans, into) {
  (spans || []).forEach(s => {
    if (!s || !s.t) return;
    /* A newline inside a span is a line break, not the two characters. */
    const parts = String(s.t).split('\n');
    parts.forEach((part, i) => {
      if (i) into.appendChild(document.createElement('br'));
      if (!part) return;
      let node = document.createTextNode(part);
      if (s.b) { const b = document.createElement('strong'); b.appendChild(node); node = b; }
      if (s.i) { const em = document.createElement('em'); em.appendChild(node); node = em; }
      const href = safeHref(s.href);
      if (href) {
        const a = document.createElement('a');
        a.href = href;
        a.rel = 'noopener noreferrer';
        if (!/^mailto:/i.test(href)) a.target = '_blank';
        a.appendChild(node);
        node = a;
      }
      into.appendChild(node);
    });
  });
}

/* A one-line summary for a card when nobody wrote a standfirst. */
function excerpt(blocks, max) {
  const cap = max || 160;
  let out = '';
  (blocks || []).forEach(b => {
    if (out.length >= cap) return;
    if (b.type === 'p' || b.type === 'quote') {
      out += (out ? ' ' : '') + (b.spans || []).map(s => s.t).join('');
    }
  });
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > cap ? out.slice(0, cap - 1).replace(/\s\S*$/, '') + '…' : out;
}

return { fromDom, toDom, spansOf, excerpt };
}));
