'use strict';
/* ============================================================================
   MANAGER - THE BADGE (core). A badge is a small object - its shape, three colours, a pattern, up to three letters, an
   emblem - drawn as SVG anywhere the club appears (the table, the fixtures, the leaderboard), so it costs a few bytes
   to store and stays sharp at any size. An uploaded image replaces the drawing (badge.img: a data: URL the page made
   from the file, 96 x 96, at most IMG_MAX characters).
     svg(b, size) -> '<svg ...>'          defaults() -> a badge          sanitise(b) -> the stored fields only, checked
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.Mgr = root.Mgr || {}; root.Mgr.badge = api; }
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const SHAPES = ['shield', 'round', 'crest', 'diamond', 'hex', 'square'];
const PATTERNS = ['plain', 'stripes', 'hoops', 'halves', 'sash', 'chevron', 'quarters', 'border'];
const EMBLEMS = ['none', 'ball', 'star', 'crown', 'bolt', 'hoop', 'tower'];
const HEX = /^#[0-9a-f]{6}$/i;
/* an uploaded image is kept as a small data: URL (the page makes it 96 x 96): the database takes up to 24 KB a badge */
const IMG_MAX = 16000;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function defaults(name) {
  const letters = String(name || 'FC').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 3).toUpperCase() || 'FC';
  return { shape: 'shield', pattern: 'stripes', c1: '#1d4ed8', c2: '#f8fafc', c3: '#facc15', text: letters, emblem: 'ball' };
}
function sanitise(b) {
  b = b || {};
  const d = defaults();
  const out = {
    shape: SHAPES.includes(b.shape) ? b.shape : d.shape, pattern: PATTERNS.includes(b.pattern) ? b.pattern : d.pattern,
    c1: HEX.test(b.c1) ? b.c1 : d.c1, c2: HEX.test(b.c2) ? b.c2 : d.c2, c3: HEX.test(b.c3) ? b.c3 : d.c3,
    text: String(b.text || '').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '').slice(0, 3), emblem: EMBLEMS.includes(b.emblem) ? b.emblem : d.emblem
  };
  /* an uploaded image: a small PNG, JPEG or WebP data: URL only (the page resizes it to 96 x 96 before it is kept) */
  if (typeof b.img === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.img) && b.img.length <= IMG_MAX) out.img = b.img;
  return out;
}
/* the shape's outline on a 100 x 100 box */
const PATH = {
  shield: 'M50 4 L92 16 L92 46 C92 72 74 88 50 97 C26 88 8 72 8 46 L8 16 Z',
  round: 'M50 4 A46 46 0 1 1 49.99 4 Z',
  crest: 'M14 6 L86 6 L86 58 C86 80 66 92 50 97 C34 92 14 80 14 58 Z',
  diamond: 'M50 3 L97 50 L50 97 L3 50 Z',
  hex: 'M50 3 L91 26 L91 74 L50 97 L9 74 L9 26 Z',
  square: 'M10 6 L90 6 Q94 6 94 10 L94 90 Q94 94 90 94 L10 94 Q6 94 6 90 L6 10 Q6 6 10 6 Z'
};
function patternSVG(p, c2) {
  switch (p) {
    case 'stripes': return [18, 38, 58, 78].map(x => '<rect x="' + x + '" y="0" width="10" height="100" fill="' + c2 + '"/>').join('');
    case 'hoops': return [20, 44, 68].map(y => '<rect x="0" y="' + y + '" width="100" height="12" fill="' + c2 + '"/>').join('');
    case 'halves': return '<rect x="50" y="0" width="50" height="100" fill="' + c2 + '"/>';
    case 'sash': return '<path d="M-10 20 L20 -10 L110 80 L80 110 Z" fill="' + c2 + '"/>';
    case 'chevron': return '<path d="M0 30 L50 60 L100 30 L100 48 L50 78 L0 48 Z" fill="' + c2 + '"/>';
    case 'quarters': return '<rect x="50" y="0" width="50" height="50" fill="' + c2 + '"/><rect x="0" y="50" width="50" height="50" fill="' + c2 + '"/>';
    case 'border': return '';
    default: return '';
  }
}
function emblemSVG(e, c3) {
  switch (e) {
    case 'ball': return '<g transform="translate(50 30)"><circle r="11" fill="' + c3 + '" stroke="#111" stroke-width="1.6"/><path d="M-11 0 H11 M0 -11 V11 M-7.5 -8 C-2 -3 -2 3 -7.5 8 M7.5 -8 C2 -3 2 3 7.5 8" stroke="#111" stroke-width="1.4" fill="none"/></g>';
    case 'star': return '<path transform="translate(50 30)" d="M0 -12 L3.5 -3.7 L12 -3.7 L5.2 1.6 L7.6 10.6 L0 5.4 L-7.6 10.6 L-5.2 1.6 L-12 -3.7 L-3.5 -3.7 Z" fill="' + c3 + '" stroke="#111" stroke-width="1"/>';
    case 'crown': return '<path transform="translate(50 30)" d="M-13 8 L-13 -6 L-6 0 L0 -10 L6 0 L13 -6 L13 8 Z" fill="' + c3 + '" stroke="#111" stroke-width="1.2"/>';
    case 'bolt': return '<path transform="translate(50 30)" d="M3 -13 L-8 2 L-1 2 L-4 13 L8 -3 L1 -3 Z" fill="' + c3 + '" stroke="#111" stroke-width="1"/>';
    case 'hoop': return '<g transform="translate(50 30)" fill="none" stroke="' + c3 + '" stroke-width="2.4"><path d="M-12 -6 H12"/><path d="M-10 -6 L-6 9 H6 L10 -6"/><path d="M-8 1 H8 M-7 5 H7" stroke-width="1.4"/></g>';
    case 'tower': return '<path transform="translate(50 30)" d="M-9 12 L-9 -4 L-12 -4 L-12 -11 L-7 -11 L-7 -7 L-2 -7 L-2 -11 L2 -11 L2 -7 L7 -7 L7 -11 L12 -11 L12 -4 L9 -4 L9 12 Z" fill="' + c3 + '" stroke="#111" stroke-width="1"/>';
    default: return '';
  }
}
let uid = 0;
function svg(b, size) {
  b = sanitise(b);
  const s = size || 64, id = 'mgb' + (++uid);
  if (b.img) return '<svg class="mgr-badge" width="' + s + '" height="' + s + '" viewBox="0 0 100 100" role="img" aria-hidden="true"><defs><clipPath id="' + id + '"><path d="' + PATH[b.shape] + '"/></clipPath></defs>' +
    '<image href="' + esc(b.img) + '" x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid slice" clip-path="url(#' + id + ')"/><path d="' + PATH[b.shape] + '" fill="none" stroke="' + b.c3 + '" stroke-width="3"/></svg>';
  const hasEmblem = b.emblem !== 'none', ty = hasEmblem ? 70 : 60, fs = b.text.length >= 3 ? 24 : b.text.length === 2 ? 30 : 36;
  return '<svg class="mgr-badge" width="' + s + '" height="' + s + '" viewBox="0 0 100 100" role="img" aria-hidden="true"><defs><clipPath id="' + id + '"><path d="' + PATH[b.shape] + '"/></clipPath></defs>' +
    '<g clip-path="url(#' + id + ')"><rect width="100" height="100" fill="' + b.c1 + '"/>' + patternSVG(b.pattern, b.c2) + '</g>' +
    '<path d="' + PATH[b.shape] + '" fill="none" stroke="' + b.c3 + '" stroke-width="' + (b.pattern === 'border' ? 8 : 3.5) + '"/>' + emblemSVG(b.emblem, b.c3) +
    (b.text ? '<text x="50" y="' + ty + '" text-anchor="middle" dominant-baseline="middle" font-family="Archivo, Arial Black, sans-serif" font-weight="900" font-size="' + fs + '" fill="' + b.c2 +
      '" stroke="' + b.c1 + '" stroke-width="2.5" paint-order="stroke">' + esc(b.text) + '</text>' : '') + '</svg>';
}

return { svg, defaults, sanitise, SHAPES, PATTERNS, EMBLEMS, IMG_MAX };
}));
