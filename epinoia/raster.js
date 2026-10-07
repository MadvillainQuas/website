'use strict';
/* ============================================================================
   A PAGE OF THE SITE AS A PICTURE (report.js): an element drawn to a canvas, then saved as PNGs or one PDF.

   HOW. The element is copied with every style it shows inlined (each element's computed style, written only where it
   differs from what that element would have by default, its ::before and ::after made real), the fonts it uses and
   its images turned into data: URLs, and the whole put in an SVG's foreignObject. The browser draws that SVG onto a
   canvas at three times the page's size (about 290 dpi on A4), so the picture is the page as the browser laid it out:
   the same fonts, colours, colour-mix() and all, with nothing re-implemented.

   OUT.
     canvasOf(node, {scale})            -> a canvas
     savePdf(nodes, name, {title, outline}) one A4 PDF, a page per node (each a JPEG at that resolution), downloaded; an
                                        element with data-goto="N" is a link to page N, and outline the bookmarks
     pdfBytes(nodes, {title})           the same PDF's bytes, not downloaded (PRIME REPORT keeps them for sending)
     saveImages(nodes, name)            one PNG per node, a ZIP of them when there is more than one, downloaded
     pdfFromJpegs([{bytes, w, h}], meta) and zip(files) are the writers, pure (no library, every offset counted)

   A browser that will not draw a foreignObject to a canvas it can read back (some Safari versions) throws; the report
   then says to use Print, which saves a PDF with the text kept as text.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaRaster = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const SVGNS = 'http://www.w3.org/2000/svg', XHTML = 'http://www.w3.org/1999/xhtml';
/* the boxes whose height is their content's, never pinned in the copy (cloneStyled) */
const GROW = '.rp-pgroups, .rp-pg2, .rp-cells, .rp-run, .rp-run-c, .rp-pcard';

/* the properties worth carrying: layout, box, text and paint. Everything else is left to the defaults */
const PROPS = ['display', 'position', 'top', 'right', 'bottom', 'left', 'float', 'clear', 'z-index', 'box-sizing',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
  'border-collapse', 'border-spacing', 'table-layout', 'caption-side', 'vertical-align',
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'justify-content', 'align-items', 'align-content',
  'align-self', 'justify-items', 'justify-self', 'order', 'gap', 'row-gap', 'column-gap',
  'grid-template-columns', 'grid-template-rows', 'grid-template-areas', 'grid-auto-flow', 'grid-auto-rows', 'grid-auto-columns',
  'grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end',
  'overflow-x', 'overflow-y', 'visibility', 'opacity', 'transform', 'transform-origin', 'zoom',
  'color', 'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat', 'background-clip',
  'box-shadow', 'outline-style', 'outline-width', 'outline-color', 'outline-offset', 'filter', 'mix-blend-mode',
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-variant-numeric', 'font-feature-settings',
  'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-transform', 'text-decoration-line', 'text-decoration-color',
  'text-decoration-style', 'text-indent', 'text-overflow', 'text-shadow', 'white-space', 'word-break', 'overflow-wrap',
  'hyphens', 'direction', 'list-style-type', 'list-style-position', 'object-fit', 'object-position', 'aspect-ratio',
  'columns', 'column-count', 'column-width', 'column-rule-style', 'column-rule-width', 'column-rule-color', 'break-inside',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset',
  'stroke-linecap', 'stroke-linejoin', 'text-anchor', 'dominant-baseline', 'paint-order', 'vector-effect', 'clip-path', 'mask-image',
  'content', 'cursor', 'pointer-events', 'isolation', 'container-type', 'counter-reset', 'counter-increment', 'quotes'];

/* each tag's own defaults, read from a clean frame once */
let defFrame = null;
const defCache = new Map();
function defaultsOf(node) {
  const svg = node.namespaceURI === SVGNS;
  const key = (svg ? 'svg:' : '') + node.localName;
  if (defCache.has(key)) return defCache.get(key);
  if (!defFrame) {
    defFrame = root.document.createElement('iframe');
    defFrame.setAttribute('aria-hidden', 'true');
    defFrame.style.cssText = 'position:absolute;left:-9999px;top:0;width:800px;height:600px;border:0;visibility:hidden';
    root.document.body.appendChild(defFrame);
  }
  const d = defFrame.contentDocument;
  let probe;
  if (svg) {
    const s = d.createElementNS(SVGNS, 'svg');
    d.body.appendChild(s);
    probe = d.createElementNS(SVGNS, node.localName);
    s.appendChild(probe);
  } else {
    probe = d.createElement(node.localName);
    d.body.appendChild(probe);
  }
  const cs = d.defaultView.getComputedStyle(probe);
  const out = {};
  PROPS.forEach(p => { out[p] = cs.getPropertyValue(p); });
  (svg ? probe.ownerSVGElement || probe : probe).remove();
  defCache.set(key, out);
  return out;
}

/* AN ELEMENT WITH TEXT OF ITS OWN IS NOT GIVEN ITS WIDTH: the picture lays text out a hair wider than the page did
   (the page is drawn at the screen's zoom, the picture at its own), and a box exactly as wide as its words would wrap */
const SIZE = new Set(['width', 'height']);
/* THE PROPERTIES A CHILD INHERITS are written where they differ from its parent's, not only from the tag's default: a
   child that sets one back to its default (text-transform:none under an uppercase label, a normal weight inside a bold
   one) would otherwise take its parent's in the copy, which carries the parent's on its style attribute (2026-10-02,
   the on/off rows' "lower is better", printed in the label's capitals) */
const INHERITED = new Set(['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-variant-numeric',
  'font-feature-settings', 'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-transform', 'text-indent', 'text-shadow',
  'white-space', 'word-break', 'overflow-wrap', 'hyphens', 'direction', 'list-style-type', 'list-style-position', 'visibility', 'cursor',
  'quotes', 'border-collapse', 'border-spacing', 'caption-side', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width',
  'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'text-anchor', 'dominant-baseline',
  'paint-order', 'pointer-events']);
function styleText(cs, defs, pseudo, free, parent) {
  let s = '';
  PROPS.forEach(p => {
    const v = cs.getPropertyValue(p);
    if (!v) return;
    if (free && SIZE.has(p)) return;
    if (p === 'content' && !pseudo) return;
    if (!pseudo && defs && defs[p] === v && !(parent && INHERITED.has(p) && parent.getPropertyValue(p) !== v)) return;
    s += p + ':' + v + ';';
  });
  return s;
}

/* the copy, with every style inlined. The page's width and height are fixed on the root so it lays out as it did */
function cloneStyled(src) {
  const walk = (n, top) => {
    if (n.nodeType === 3) return root.document.createTextNode(n.nodeValue);
    if (n.nodeType !== 1) return null;
    const tag = n.localName;
    if (tag === 'script' || tag === 'style' || tag === 'noscript') return null;
    const svg = n.namespaceURI === SVGNS;
    const cs = root.getComputedStyle(n);
    if (cs.display === 'none' && !svg) return null;
    const c = svg ? root.document.createElementNS(SVGNS, tag) : root.document.createElement(tag === 'canvas' ? 'img' : tag);
    for (const a of n.attributes) {
      if (/^on/i.test(a.name) || a.name === 'style' || a.name === 'class') continue;   // ids stay: a gradient or a <use> points at one
      try { c.setAttribute(a.name, a.value); } catch (_) { /* an odd attribute */ }
    }
    if (tag === 'canvas') { try { c.setAttribute('src', n.toDataURL('image/png')); } catch (_) { /* tainted */ } }
    if (tag === 'input' || tag === 'textarea') c.setAttribute('value', n.value || '');
    const ownText = !svg && tag !== 'img' && [...n.childNodes].some(x => x.nodeType === 3 && x.nodeValue.trim());
    /* the copy's root has no parent in the picture but the page's defaults; everything under it has its copied parent */
    const par = !top && n.parentElement ? root.getComputedStyle(n.parentElement) : null;
    let st = styleText(cs, defaultsOf(n), false, ownText && cs.position !== 'absolute', par);
    /* BOXES THAT WRAP KEEP THEIR OWN HEIGHT (2026-10-06): a player card's groups and the cells in them are rows that wrap. Pinned
       to the height the page measured, a row the copy wraps one cell earlier (its text a hair wider) ran under the next group:
       the shot profile's THREE under DRIVES L/R. Left to grow, the copy is as tall as it needs to be. */
    if (!svg && n.matches && n.matches(GROW)) st = st.replace(/(^|;)\s*height:[^;]*/g, '$1');
    c.setAttribute('style', st);
    /* A <col span=n>: its computed width is the TOTAL of its n columns, and inlined it would be given to each of them - n times
       too wide, the table run off the page (the zone table, 2026-10-04). Each column gets its share. */
    if ((tag === 'col' || tag === 'colgroup') && n.span > 1 && parseFloat(cs.width) > 0) c.setAttribute('style', c.getAttribute('style') + ';width:' + (parseFloat(cs.width) / n.span).toFixed(2) + 'px');
    const pseudo = ps => {
      if (svg) return null;
      const pcs = root.getComputedStyle(n, ps);
      const content = pcs.getPropertyValue('content');
      if (!content || content === 'none' || content === 'normal') return null;
      const sp = root.document.createElement('span');
      sp.textContent = /^["']/.test(content) ? content.slice(1, -1).replace(/\\a/g, '\n').replace(/\\(.)/g, '$1') : '';
      sp.setAttribute('style', styleText(pcs, null, true).replace(/(^|;)content:[^;]*;/, '$1'));
      return sp;
    };
    const before = pseudo('::before'), after = pseudo('::after');
    if (before) c.appendChild(before);
    for (const ch of n.childNodes) { const x = walk(ch, false); if (x) c.appendChild(x); }
    if (after) c.appendChild(after);
    return c;
  };
  const out = walk(src, true);
  return out;
}

/* ---- fonts and images, as data: URLs ---- */
const toB64 = buf => {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return root.btoa(s);
};
const dataCache = new Map();
async function dataUrl(url) {
  if (!url || /^data:/.test(url)) return url;
  if (dataCache.has(url)) return dataCache.get(url);
  const p = (async () => {
    const r = await root.fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!r.ok) throw new Error(r.status);
    const type = r.headers.get('content-type') || 'application/octet-stream';
    return 'data:' + type.split(';')[0] + ';base64,' + toB64(await r.arrayBuffer());
  })();
  dataCache.set(url, p);
  p.catch(() => dataCache.delete(url));
  return p;
}

/* the page's @font-face rules (the kit's own: same origin), with each font file inlined */
let fontCss = null;
function fonts() {
  if (fontCss) return fontCss;
  fontCss = (async () => {
    const rules = [];
    for (const sh of root.document.styleSheets) {
      let list;
      try { list = sh.cssRules; } catch (_) { continue; }
      if (!list) continue;
      for (const r of list) if (r.type === 5 /* FONT_FACE */) rules.push({ css: r.cssText, base: sh.href || root.location.href });
    }
    const out = [];
    for (const r of rules) {
      let css = r.css;
      const urls = [...css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)].map(m => m[2]);
      for (const u of urls) {
        try { css = css.split(u).join(await dataUrl(new URL(u, r.base).href)); } catch (_) { /* that face falls back */ }
      }
      out.push(css);
    }
    return out.join('\n');
  })();
  return fontCss;
}

async function inlineImages(node) {
  const imgs = [...node.querySelectorAll('img')];
  await Promise.all(imgs.map(async im => {
    const src = im.getAttribute('src');
    if (!src || /^data:/.test(src)) return;
    try { im.setAttribute('src', await dataUrl(new URL(src, root.location.href).href)); }
    catch (_) { im.removeAttribute('src'); im.setAttribute('style', (im.getAttribute('style') || '') + 'visibility:hidden;'); }
  }));
  const withBg = [node, ...node.querySelectorAll('*')].filter(n => /url\(/.test(n.getAttribute('style') || ''));
  for (const n of withBg) {
    let st = n.getAttribute('style');
    for (const m of [...st.matchAll(/url\((['"]?)([^'")]+)\1\)/g)]) {
      if (/^data:/.test(m[2])) continue;
      try { st = st.split(m[2]).join(await dataUrl(new URL(m[2], root.location.href).href)); } catch (_) { st = st.split(m[0]).join('none'); }
    }
    n.setAttribute('style', st);
  }
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new root.Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('the page could not be drawn'));
    im.src = src;
  });
}

/* THE CANVAS. The node's own size (offsetWidth/Height: its layout size, whatever zoom the page around it wears) */
async function canvasOf(node, opt) {
  const o = Object.assign({ scale: 3, background: '#ffffff' }, opt || {});
  const w = o.w || node.offsetWidth, h = o.h || node.offsetHeight;
  if (root.document.fonts && root.document.fonts.ready) await root.document.fonts.ready;
  const copy = cloneStyled(node);
  /* SAFARI AND EVERY BROWSER ON AN IPHONE (WebKit) DRAW A foreignObject'S CONTENT AT 1x INSIDE A LARGER SVG, whatever the viewBox
     says: the page came out in the top-left third of its canvas, its half court blank (2026-10-03, a report downloaded on an
     iPhone). There the svg is the picture's own size and the copy is scaled by a CSS transform, laid out at 1x as before. */
  const ua = (root.navigator && root.navigator.userAgent) || '';
  const webkit = /CriOS|FxiOS|EdgiOS/.test(ua) || (/AppleWebKit/.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua));
  const scaled = webkit && o.scale !== 1;
  copy.setAttribute('style', copy.getAttribute('style') + 'margin:0;zoom:1;width:' + w + 'px;height:' + h + 'px;' +
    (scaled ? 'transform:scale(' + o.scale + ');transform-origin:0 0;' : 'transform:none;'));
  copy.setAttribute('xmlns', XHTML);
  await inlineImages(copy);
  const css = await fonts();
  const xml = new root.XMLSerializer().serializeToString(copy);
  const W = w * o.scale, H = h * o.scale;
  const svg = scaled
    ? '<svg xmlns="' + SVGNS + '" width="' + W + '" height="' + H + '">' +
      '<defs><style>' + css.replace(/<\/?style/gi, '') + '</style></defs>' +
      '<foreignObject x="0" y="0" width="' + W + '" height="' + H + '">' + xml + '</foreignObject></svg>'
    : '<svg xmlns="' + SVGNS + '" width="' + W + '" height="' + H + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<defs><style>' + css.replace(/<\/?style/gi, '') + '</style></defs>' +
      '<foreignObject x="0" y="0" width="' + w + '" height="' + h + '">' + xml + '</foreignObject></svg>';
  const im = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  const c = root.document.createElement('canvas');
  c.width = Math.round(w * o.scale); c.height = Math.round(h * o.scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = o.background; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(im, 0, 0, c.width, c.height);
  /* some browsers draw a foreignObject only on the second ask (its fonts and images decoded the first time) */
  if (o.second !== false) { await new Promise(r => setTimeout(r, 30)); ctx.drawImage(im, 0, 0, c.width, c.height); }
  c.toDataURL('image/png', 0.1).length;            // throws here, not later, where the canvas cannot be read back
  return c;
}

const blobOf = (c, type, q) => new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('no image'))), type, q));

/* ---- the PDF: a page per image, each filling an A4 page ---- */
const A4_PT = [595.28, 841.89];
const pdfText = s => '(' + String(s || '').replace(/[^\x20-\x7e]/g, '').replace(/([\\()])/g, '\\$1') + ')';
/* any text at all (a bookmark: 'Shot clock · defence', a player's accented name), as UTF-16 with its byte-order mark */
const pdfUni = s => '<FEFF' + [...String(s || '')].map(ch => { const c = ch.codePointAt(0);
  if (c < 0x10000) return c.toString(16).padStart(4, '0');
  const v = c - 0x10000; return (0xd800 + (v >> 10)).toString(16) + (0xdc00 + (v & 1023)).toString(16); }).join('').toUpperCase() + '>';
const pad2 = n => String(n).padStart(2, '0');
const pdfDate = d => 'D:' + d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
/* THE PDF CAN BE FOUND YOUR WAY ROUND (2026-10-07): a page's links (pages[i].links: [{ x, y, w, h, page }], the box as fractions
   of the page from its top left, page counted from 1) become link annotations that jump to that page - the cover's contents, a
   page's number back to the contents - and meta.outline ([{ title, page, kids: [same] }]) the bookmarks a PDF reader shows down
   its side, two deep: the sections, and the headings in each */
function pdfFromJpegs(pages, meta) {
  const mt = meta || {}, page = mt.page || A4_PT;
  const enc = s => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };
  const parts = [], offsets = [];
  let len = 0;
  const put = b => { parts.push(b); len += b.length; };
  const obj = (n, body, stream) => {
    offsets[n] = len;
    put(enc(n + ' 0 obj\n' + body + (stream ? '\nstream\n' : '\nendobj\n')));
    if (stream) { put(stream); put(enc('\nendstream\nendobj\n')); }
  };
  const n = pages.length;
  /* 1 catalog, 2 pages, then three objects a page (page, image, contents), then the info; then the links and the bookmarks */
  const pageObj = i => 3 + i * 3, info = 3 + n * 3;
  let next = info + 1;
  const okPage = q => Number.isInteger(+q) && +q >= 1 && +q <= n;
  const dest = q => '[' + pageObj(+q - 1) + ' 0 R /Fit]';
  const annots = pages.map(p => (p.links || []).filter(l => l && okPage(l.page) && l.w > 0 && l.h > 0).map(l => ({ l, id: next++ })));
  const outline = [];
  const walk = (list, parent) => (list || []).filter(o => o && okPage(o.page) && String(o.title || '').trim()).map(o => {
    const it = { o, id: next++, parent, kids: [] };
    outline.push(it);
    it.kids = walk(o.kids, it);
    return it;
  });
  const outRoot = (mt.outline || []).length ? next++ : 0;
  const top = outRoot ? walk(mt.outline, null) : [];
  put(enc('%PDF-1.4\n%âãÏÓ\n'));
  obj(1, '<< /Type /Catalog /Pages 2 0 R' + (top.length ? ' /Outlines ' + outRoot + ' 0 R /PageMode /UseOutlines' : '') + ' >>');
  obj(2, '<< /Type /Pages /Kids [' + pages.map((_, i) => pageObj(i) + ' 0 R').join(' ') + '] /Count ' + n + ' >>');
  const place = [];
  pages.forEach((p, i) => {
    const s = Math.min(page[0] / p.w, page[1] / p.h);
    const w = +(p.w * s).toFixed(2), h = +(p.h * s).toFixed(2);
    const x = +((page[0] - w) / 2).toFixed(2), y = +((page[1] - h) / 2).toFixed(2);
    place[i] = { x, y, w, h };
    const draw = enc('q ' + w + ' 0 0 ' + h + ' ' + x + ' ' + y + ' cm /Im0 Do Q');
    obj(pageObj(i), '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + page[0] + ' ' + page[1] + '] ' +
      '/Resources << /XObject << /Im0 ' + (pageObj(i) + 1) + ' 0 R >> >> /Contents ' + (pageObj(i) + 2) + ' 0 R' +
      (annots[i].length ? ' /Annots [' + annots[i].map(a => a.id + ' 0 R').join(' ') + ']' : '') + ' >>');
    obj(pageObj(i) + 1, '<< /Type /XObject /Subtype /Image /Width ' + p.w + ' /Height ' + p.h +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.bytes.length + ' >>', p.bytes);
    obj(pageObj(i) + 2, '<< /Length ' + draw.length + ' >>', draw);
  });
  obj(info, '<< /Title ' + pdfText(mt.title || 'Report') + ' /Producer (Epinoia) /Creator (Epinoia report) /CreationDate (' + pdfDate(mt.date || new Date()) + ') >>');
  /* a link's box: its fractions of the picture, on the picture's place on the page (PDF's origin is the bottom left) */
  const f2 = v => (+v).toFixed(2);
  annots.forEach((list, i) => list.forEach(({ l, id }) => {
    const P = place[i], x0 = P.x + l.x * P.w, y1 = P.y + P.h - l.y * P.h;
    obj(id, '<< /Type /Annot /Subtype /Link /Rect [' + f2(x0) + ' ' + f2(y1 - l.h * P.h) + ' ' + f2(x0 + l.w * P.w) + ' ' + f2(y1) + '] /Border [0 0 0] /Dest ' + dest(l.page) + ' >>');
  }));
  if (outRoot) {
    const count = list => list.reduce((a, it) => a + 1 + count(it.kids), 0);
    obj(outRoot, '<< /Type /Outlines' + (top.length ? ' /First ' + top[0].id + ' 0 R /Last ' + top[top.length - 1].id + ' 0 R /Count ' + top.length : ' /Count 0') + ' >>');       // the open items: the sections (their headings start folded)
    /* a section's headings start folded (a negative count): the reader opens the one they want */
    outline.forEach(it => {
      const sib = it.parent ? it.parent.kids : top, k = sib.indexOf(it);
      obj(it.id, '<< /Title ' + pdfUni(it.o.title) + ' /Parent ' + (it.parent ? it.parent.id : outRoot) + ' 0 R' +
        (k > 0 ? ' /Prev ' + sib[k - 1].id + ' 0 R' : '') + (k < sib.length - 1 ? ' /Next ' + sib[k + 1].id + ' 0 R' : '') +
        (it.kids.length ? ' /First ' + it.kids[0].id + ' 0 R /Last ' + it.kids[it.kids.length - 1].id + ' 0 R /Count -' + count(it.kids) : '') +
        ' /Dest ' + dest(it.o.page) + ' >>');
    });
  }
  const size = next;
  const xref = len;
  let table = 'xref\n0 ' + size + '\n0000000000 65535 f \n';
  for (let k = 1; k < size; k++) table += String(offsets[k]).padStart(10, '0') + ' 00000 n \n';
  put(enc(table + 'trailer\n<< /Size ' + size + ' /Root 1 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n'));
  const out = new Uint8Array(len);
  let at = 0;
  parts.forEach(b => { out.set(b, at); at += b.length; });
  return out;
}

/* ---- the ZIP: stored, not compressed (a PNG already is) ---- */
let CRC = null;
function crc32(bytes) {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zip(files, when) {
  const d = when || new Date();
  const tm = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dt = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const utf8 = s => new TextEncoder().encode(s);
  const locals = [], central = [];
  let off = 0;
  files.forEach(f => {
    const name = utf8(f.name), data = f.bytes, crc = crc32(data);
    const lh = new Uint8Array(30 + name.length), h = new DataView(lh.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, tm, true); h.setUint16(12, dt, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length), c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, tm, true); c.setUint16(14, dt, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    ch.set(name, 46);
    locals.push(lh, data); central.push(ch);
    off += lh.length + data.length;
  });
  const cdLen = central.reduce((a, b) => a + b.length, 0);
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cdLen, true); e.setUint32(16, off, true);
  const all = locals.concat(central, [end]);
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let at = 0; all.forEach(b => { out.set(b, at); at += b.length; });
  return out;
}

function download(blob, name) {
  const url = root.URL.createObjectURL(blob);
  const a = root.document.createElement('a');
  a.href = url; a.download = name;
  root.document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => root.URL.revokeObjectURL(url), 60000);
}

/* the links on a page: every element with data-goto (a page number, from 1), its box as fractions of the page's */
function linksOf(node) {
  if (!node || !node.getBoundingClientRect || !node.querySelectorAll) return [];
  const R = node.getBoundingClientRect();
  if (!(R.width > 0 && R.height > 0)) return [];
  return [...node.querySelectorAll('[data-goto]')].map(e => {
    const r = e.getBoundingClientRect();
    return { x: (r.left - R.left) / R.width, y: (r.top - R.top) / R.height, w: r.width / R.width, h: r.height / R.height, page: +e.getAttribute('data-goto') };
  }).filter(l => l.w > 0 && l.h > 0 && l.page > 0);
}
/* the PDF's bytes, a page per node, without downloading it (report.js PRIME REPORT keeps them for sending, 0229) */
async function pdfBytes(nodes, opt) {
  const o = opt || {};
  const pages = [];
  for (let i = 0; i < nodes.length; i++) {
    if (o.onProgress) o.onProgress(i + 1, nodes.length);
    const links = linksOf(nodes[i]);
    const c = await canvasOf(nodes[i], { scale: o.scale || 3, w: o.w, h: o.h });
    pages.push({ bytes: new Uint8Array(await (await blobOf(c, 'image/jpeg', o.quality || 0.9)).arrayBuffer()), w: c.width, h: c.height, links });
    c.width = c.height = 1;
  }
  return pdfFromJpegs(pages, { title: o.title, date: new Date(), outline: o.outline || null });
}
async function savePdf(nodes, name, opt) {
  const bytes = await pdfBytes(nodes, opt);
  download(new root.Blob([bytes], { type: 'application/pdf' }), name + '.pdf');
}

async function saveImages(nodes, name, opt) {
  const o = opt || {};
  const files = [];
  for (let i = 0; i < nodes.length; i++) {
    if (o.onProgress) o.onProgress(i + 1, nodes.length);
    const c = await canvasOf(nodes[i], { scale: o.scale || 3, w: o.w, h: o.h });
    files.push({ name: name + '-p' + String(i + 1).padStart(2, '0') + '.png', bytes: new Uint8Array(await (await blobOf(c, 'image/png')).arrayBuffer()) });
    c.width = c.height = 1;
  }
  if (files.length === 1) download(new root.Blob([files[0].bytes], { type: 'image/png' }), files[0].name);
  else download(new root.Blob([zip(files)], { type: 'application/zip' }), name + '-pages.zip');
}

return { canvasOf, savePdf, pdfBytes, saveImages, pdfFromJpegs, zip, crc32, PROPS };
}));
