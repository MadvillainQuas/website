'use strict';
/* ============================================================================
   THE CREATORS' ICONS (the creator hub, 0200).   window.EpinoiaIcons

   A set of basketball icons drawn for Epinoia - line icons on a 24-unit square, round ends, the same weight as the
   site's own bell and calendar - for a creator to put in their own graphics, thumbnails and videos. Any colour (a
   league's, white, ink), any weight, as SVG or as a PNG at the size wanted; every one or the whole set.

     LIST                               [{ key, name, d }]
     svg(key, { colour, weight, bg, pad })   the SVG as text (colour and bg: #rrggbb only)
     node(key, opts)                    an <svg> element to show on a page
     png(key, { px, ... })              Promise<Blob>: the icon drawn at px square
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaIcons = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* each: a key (its file name), a name, and its path on the 24-unit square */
const LIST = [
  { key: 'basketball', name: 'Basketball', d: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M3 12h18 M12 3v18 M5.6 5.6c3.4 3.6 3.4 9.2 0 12.8 M18.4 5.6c-3.4 3.6-3.4 9.2 0 12.8' },
  { key: 'hoop', name: 'Hoop', d: 'M4 3h16v8H4z M9 7h6v4 M7 11h10 M8 11l1.5 8 M16 11l-1.5 8 M12 11v8 M8.8 15h6.4 M9.5 19h5' },
  { key: 'court', name: 'Court', d: 'M3 5h18v14H3z M12 5v14 M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z M3 9h3.5v6H3 M21 9h-3.5v6H21' },
  { key: 'whistle', name: 'Whistle', d: 'M9 9a5 5 0 1 0 5 5V9z M14 9h7v4h-7 M9 14h.01 M5 6l1.5 1.5' },
  { key: 'shot-clock', name: 'Shot clock', d: 'M12 5a8 8 0 1 0 0 16a8 8 0 1 0 0-16z M12 13V9 M12 13l3 2 M10 2h4 M19 5l1.5-1.5' },
  { key: 'scoreboard', name: 'Scoreboard', d: 'M3 4h18v12H3z M12 4v12 M6.5 8h2v4h-2z M15.5 8h2v4h-2z M9 20h6 M12 16v4' },
  { key: 'trophy', name: 'Trophy', d: 'M8 4h8v5a4 4 0 0 1-8 0z M8 6H5a3 3 0 0 0 3 4.5 M16 6h3a3 3 0 0 1-3 4.5 M12 13v4 M8 21h8 M9 17h6v4H9z' },
  { key: 'medal', name: 'Medal', d: 'M12 11a5 5 0 1 0 0 10a5 5 0 1 0 0-10z M8.5 3l2.5 8 M15.5 3l-2.5 8 M8.5 3h7 M12 14v4' },
  { key: 'jersey', name: 'Jersey', d: 'M8 3a4 4 0 0 0 8 0l4 2-1.5 5-2.5-1v12H8V9l-2.5 1L4 5z M10 13h4 M12 13v4' },
  { key: 'sneaker', name: 'Sneaker', d: 'M3 18h18v-2.5a3 3 0 0 0-3-3h-3l-4-6H6.5L5.5 9H3z M3 18v1.5h18V18 M9 10h2 M10.5 12.5h2' },
  { key: 'playbook', name: 'Playbook', d: 'M9 3h6v3H9z M7 4.5H5V21h14V4.5h-2 M8 10l3 3 M11 10l-3 3 M15.5 15.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3z M13 10c2.5 0 3.5 1.5 3 4.5' },
  { key: 'stats', name: 'Stats', d: 'M4 20V11 M10 20V4 M16 20v-7 M3 20h18 M20 20V8' },
  { key: 'trending-up', name: 'Trending up', d: 'M3 17l6-6 4 4 8-8 M15 7h6v6' },
  { key: 'trending-down', name: 'Trending down', d: 'M3 7l6 6 4-4 8 8 M15 17h6v-6' },
  { key: 'hot-streak', name: 'Hot streak', d: 'M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.4-4 2.4-5 .4 2 1.5 3 2.6 3 0-3-1-5.3 0-8z' },
  { key: 'cold-streak', name: 'Cold streak', d: 'M12 3v18 M4.2 7.5l15.6 9 M19.8 7.5l-15.6 9 M9.5 4.5L12 7l2.5-2.5 M9.5 19.5L12 17l2.5 2.5' },
  { key: 'star', name: 'Star', d: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z' },
  { key: 'mvp', name: 'MVP', d: 'M4 18h16 M4 18L3 8l5 4 4-7 4 7 5-4-1 10 M4 21h16' },
  { key: 'fixtures', name: 'Fixtures', d: 'M4 5h16v15H4z M4 10h16 M8 3v4 M16 3v4 M8 14h3v3H8z' },
  { key: 'arena', name: 'Arena', d: 'M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z M12 8a2 2 0 1 0 0 4a2 2 0 1 0 0-4z' },
  { key: 'ticket', name: 'Ticket', d: 'M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z M15 7v10' },
  { key: 'podcast', name: 'Podcast', d: 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M6 11a6 6 0 0 0 12 0 M12 17v4 M9 21h6' },
  { key: 'video', name: 'Video', d: 'M3 7h12v10H3z M15 11l6-3v8l-6-3' },
  { key: 'photo', name: 'Photo', d: 'M4 8h3l2-3h6l2 3h3v11H4z M12 9.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7z' },
  { key: 'announce', name: 'Announcement', d: 'M3 10v4h3l7 5V5l-7 5z M16 9a4 4 0 0 1 0 6 M19 6a8 8 0 0 1 0 12' },
  { key: 'play', name: 'Play', d: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M10 8l6 4-6 4z' },
  { key: 'listen', name: 'Listen', d: 'M4 15v-3a8 8 0 0 1 16 0v3 M4 15h3v5H4z M17 15h3v5h-3z' },
  { key: 'transfer', name: 'Transfer', d: 'M4 8h15 M15 4l4 4-4 4 M20 16H5 M9 12l-4 4 4 4' },
  { key: 'injury', name: 'Injury', d: 'M12 4v16 M4 12h16 M7 4h10v16H7z' },
  { key: 'crowd', name: 'Fans', d: 'M8 9a2.5 2.5 0 1 0 0-5a2.5 2.5 0 1 0 0 5z M16 9a2.5 2.5 0 1 0 0-5a2.5 2.5 0 1 0 0 5z M3 20v-2a5 5 0 0 1 10 0v2 M11 20v-2a5 5 0 0 1 10 0v2' }
];
const BY = new Map(LIST.map(i => [i.key, i]));
const HEX = /^#[0-9a-fA-F]{6}$/;

/* THE SVG, as text: only this file's own paths and a checked colour go in, so nothing a reader typed ever does */
function svg(key, o) {
  const it = BY.get(key);
  if (!it) return '';
  const opts = o || {};
  const colour = HEX.test(opts.colour || '') ? opts.colour : '#0d1f17';
  const weight = Math.max(0.75, Math.min(3, Number(opts.weight) || 1.8));
  const pad = Math.max(0, Math.min(6, Number(opts.pad) || 0));
  const box = (-pad) + ' ' + (-pad) + ' ' + (24 + pad * 2) + ' ' + (24 + pad * 2);
  const bg = HEX.test(opts.bg || '') ? '<rect x="' + (-pad) + '" y="' + (-pad) + '" width="' + (24 + pad * 2) + '" height="' + (24 + pad * 2) + '" rx="' + (3 + pad) + '" fill="' + opts.bg + '"/>' : '';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + box + '" width="' + (opts.px || 24) + '" height="' + (opts.px || 24) + '">' + bg +
    '<path d="' + it.d + '" fill="none" stroke="' + colour + '" stroke-width="' + weight + '" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function node(key, o) {
  const doc = root.document;
  const it = BY.get(key);
  if (!doc || !it) return null;
  const NS = 'http://www.w3.org/2000/svg';
  const opts = o || {};
  const s = doc.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  const p = doc.createElementNS(NS, 'path');
  p.setAttribute('d', it.d);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', HEX.test(opts.colour || '') ? opts.colour : 'currentColor');
  p.setAttribute('stroke-width', String(Math.max(0.75, Math.min(3, Number(opts.weight) || 1.8))));
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  s.appendChild(p);
  return s;
}

/* A PNG at px square: the SVG drawn on a canvas (an image the page made itself, so the canvas stays readable) */
function png(key, o) {
  const opts = Object.assign({ px: 512 }, o || {});
  const px = Math.max(16, Math.min(2048, opts.px | 0));
  return new Promise((resolve, reject) => {
    const text = svg(key, Object.assign({}, opts, { px }));
    if (!text) { reject(new Error('no such icon')); return; }
    const img = new root.Image();
    img.onload = () => {
      const c = root.document.createElement('canvas');
      c.width = c.height = px;
      c.getContext('2d').drawImage(img, 0, 0, px, px);
      c.toBlob(b => (b ? resolve(b) : reject(new Error('the icon could not be drawn'))), 'image/png');
    };
    img.onerror = () => reject(new Error('the icon could not be drawn'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
  });
}

return { LIST, svg, node, png };
}));
