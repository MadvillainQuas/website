'use strict';
/* ============================================================================
   PRINT FILES.

   The merchandise section draws MOCKUPS — a shirt with a crest on it, at screen
   size, for somebody to look at. A print-on-demand factory needs something
   completely different: the DESIGN ALONE, on transparency, at the physical size
   it will be printed, at 300 dots per inch. No garment, no shadow, no page
   background. Confusing the two is the classic way to end up with a t-shirt
   that has a picture of a t-shirt on it.

   So this is a separate module from merch.js on purpose. It takes what the
   platform already has stored and curated — the club's APPROVED logo, its
   colours, its name — and emits an SVG at print dimensions. Pure: a string in,
   a string out, no DOM, no network, no canvas. That makes it testable, and it
   makes the same file usable from the browser and from an Edge Function.

   WHY SVG AND NOT A BITMAP. Vector artwork scales to any garment size without
   a second source file, and a monogram design has no photographic content to
   lose. Where a club has uploaded a raster logo it is embedded as a data URI
   at whatever resolution they gave us, which is the honest ceiling — this
   cannot invent detail the upload did not have, and it says so in the warnings
   rather than quietly printing a blurry crest on fifty shirts.

   RASTERISING IS SOMEBODY ELSE'S JOB. The caller turns this into the PNG the
   factory wants, because how you rasterise depends on where you are running.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaArtwork = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const DPI = 300;
const inch = (n) => Math.round(n * DPI);

/* ------------------------------------------------------------- the sheet ---
   Real print areas, in inches, as the major print-on-demand catalogues
   describe them. A league can override any of these; these are what a product
   gets if nobody says otherwise.

   `safe` is the fraction of the sheet kept clear at the edges. Every factory
   trims, and a design that runs to the edge of the stated print area is a
   design that comes back cropped from a proportion of the run. */
const SHEETS = {
  tee:    { w: 12,   h: 16,   safe: 0.06, label: 'Front print, adult tee' },
  hoodie: { w: 12,   h: 14,   safe: 0.07, label: 'Front print, hoodie' },
  scarf:  { w: 8,    h: 60,   safe: 0.03, label: 'Sublimated scarf, full length' },
  poster: { w: 18,   h: 24,   safe: 0.05, label: 'Print, 18×24' },
  mug:    { w: 9,    h: 3.7,  safe: 0.08, label: 'Wrap, 11oz mug' }
};

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Two or three letters, the way the club would put them on a badge. */
function monogram(club) {
  const s = String((club && club.short_name) || '').replace(/[^A-Za-z0-9]/g, '');
  if (s) return s.slice(0, 3).toUpperCase();
  const words = String((club && club.name) || '').replace(/[^A-Za-z0-9 ]/g, ' ')
    .trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

/* A raster logo has a real resolution and a print has a real size, so whether
   one is good enough for the other is arithmetic, not an opinion. Under 150
   effective DPI is visibly soft on a garment; this reports it rather than
   letting a club find out from the parcel. */
function checkResolution(logo, drawnInches) {
  if (!logo || !logo.width || !logo.height) return null;
  const eff = Math.min(logo.width, logo.height) / drawnInches;
  if (eff >= 300) return null;
  return {
    level: eff < 150 ? 'bad' : 'warn',
    effectiveDpi: Math.round(eff),
    text: 'The club logo is ' + logo.width + '×' + logo.height + 'px, which is ' +
          Math.round(eff) + ' DPI at the size it prints here. ' +
          (eff < 150 ? 'That will look soft. Ask the club for a larger file.'
                     : 'Acceptable, but a larger file would print better.')
  };
}

/* ------------------------------------------------------------- the crest ---
   The logo if the league has approved one, the monogram if not. Identical
   geometry either way, so a club that uploads a logo later gets the same
   layout rather than a different product. */
function crest(club, cx, cy, size, ink) {
  if (club.logoDataUri) {
    return `<image x="${(cx - size / 2).toFixed(1)}" y="${(cy - size / 2).toFixed(1)}" ` +
           `width="${size.toFixed(1)}" height="${size.toFixed(1)}" ` +
           `preserveAspectRatio="xMidYMid meet" href="${esc(club.logoDataUri)}"/>`;
  }
  const r = size / 2;
  return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" ` +
         `fill="none" stroke="${esc(ink)}" stroke-width="${(size * 0.055).toFixed(1)}"/>` +
         `<text x="${cx.toFixed(1)}" y="${(cy + size * 0.155).toFixed(1)}" ` +
         `text-anchor="middle" fill="${esc(ink)}" font-family="${FONTS}" ` +
         `font-size="${(size * 0.42).toFixed(1)}" font-weight="700" ` +
         `letter-spacing="${(size * 0.01).toFixed(1)}">${esc(monogram(club))}</text>`;
}

/* A print file is rasterised somewhere with its own idea of what fonts exist,
   so the stack names families a renderer is likely to have and ends in a
   generic. Type in a print file is a risk in general; the designs below keep
   it to a club's name and a season. */
const FONTS = 'Archivo, Helvetica Neue, Helvetica, Arial, sans-serif';

/* ----------------------------------------------------------- the designs ---
   One function per product. Each is handed the sheet in PIXELS and the safe
   box inside it, and may use only what is inside the safe box. */
const DESIGNS = {
  tee(club, S, ink) {
    const cy = S.y + S.h * 0.40, size = Math.min(S.w * 0.78, S.h * 0.52);
    return crest(club, S.cx, cy, size, ink) +
      text(club.name, S.cx, cy + size * 0.66 + S.h * 0.06, S.w * 0.075, ink, S.w) +
      rule(S.cx, cy + size * 0.66 + S.h * 0.10, S.w * 0.34, ink) +
      text(club.strapline || 'EST. ' + (club.founded || ''), S.cx,
           cy + size * 0.66 + S.h * 0.155, S.w * 0.032, ink, S.w, 0.55);
  },
  hoodie(club, S, ink) {
    const cy = S.y + S.h * 0.42, size = Math.min(S.w * 0.62, S.h * 0.5);
    return crest(club, S.cx, cy, size, ink) +
      text(club.name, S.cx, cy + size * 0.66 + S.h * 0.07, S.w * 0.062, ink, S.w);
  },
  /* A scarf is read from both ends, by somebody holding it up. So the design
     is mirrored about the middle rather than running one way up. */
  scarf(club, S, ink) {
    const band = (yTop) =>
      `<rect x="${S.x}" y="${yTop.toFixed(1)}" width="${S.w}" ` +
      `height="${(S.h * 0.012).toFixed(1)}" fill="${esc(ink)}"/>`;
    const half = (yc, flip) => {
      const size = S.w * 0.5;
      const g = crest(club, S.cx, yc, size, ink) +
        text(club.name, S.cx, yc + size * 0.72, S.w * 0.1, ink, S.w);
      return flip
        ? `<g transform="rotate(180 ${S.cx.toFixed(1)} ${(S.y + S.h / 2).toFixed(1)})">${g}</g>`
        : g;
    };
    return band(S.y + S.h * 0.06) + band(S.y + S.h * 0.085) +
           band(S.y + S.h * 0.915) + band(S.y + S.h * 0.94) +
           half(S.y + S.h * 0.24, false) + half(S.y + S.h * 0.24, true);
  },
  poster(club, S, ink) {
    const cy = S.y + S.h * 0.36, size = Math.min(S.w * 0.72, S.h * 0.42);
    return `<rect x="${S.x}" y="${S.y}" width="${S.w}" height="${S.h}" ` +
             `fill="none" stroke="${esc(ink)}" stroke-width="${(S.w * 0.006).toFixed(1)}"/>` +
      crest(club, S.cx, cy, size, ink) +
      text(club.name, S.cx, S.y + S.h * 0.70, S.w * 0.085, ink, S.w) +
      rule(S.cx, S.y + S.h * 0.755, S.w * 0.5, ink) +
      text(club.season || '', S.cx, S.y + S.h * 0.82, S.w * 0.04, ink, S.w, 0.6) +
      text('EPINOIΛ', S.cx, S.y + S.h * 0.93, S.w * 0.028, ink, S.w, 0.45);
  },
  /* A mug wrap is one long strip that meets itself, and the handle sits in the
     middle of one side — so the design is two copies, one per face, and the
     centre is left empty. */
  mug(club, S, ink) {
    const size = S.h * 0.5;
    const face = (cx) => crest(club, cx, S.y + S.h * 0.42, size, ink) +
      text(club.name, cx, S.y + S.h * 0.42 + size * 0.72, S.h * 0.11, ink, S.w * 0.45);
    return face(S.x + S.w * 0.25) + face(S.x + S.w * 0.75);
  }
};

function text(s, cx, y, size, ink, maxW, opacity) {
  if (!s) return '';
  /* textLength keeps a long club name inside the safe box instead of running
     off the sheet — a renderer will squeeze it rather than clip it. */
  const est = String(s).length * size * 0.62;
  const fit = est > maxW ? ` textLength="${maxW.toFixed(0)}" lengthAdjust="spacingAndGlyphs"` : '';
  return `<text x="${cx.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" ` +
    `fill="${esc(ink)}" font-family="${FONTS}" font-size="${size.toFixed(1)}" ` +
    `font-weight="700" letter-spacing="${(size * 0.06).toFixed(1)}"` +
    (opacity ? ` opacity="${opacity}"` : '') + fit + '>' +
    esc(String(s).toUpperCase()) + '</text>';
}

function rule(cx, y, w, ink) {
  return `<rect x="${(cx - w / 2).toFixed(1)}" y="${y.toFixed(1)}" ` +
         `width="${w.toFixed(1)}" height="${Math.max(2, w * 0.012).toFixed(1)}" ` +
         `fill="${esc(ink)}" opacity="0.8"/>`;
}

/* ================================================================ build ===
   club: { name, short_name, colour, logoDataUri?, logoWidth?, logoHeight?,
           season?, founded?, strapline? }
   opts: { kind, sheet?, ink? }

   Returns { svg, width, height, kind, sheet, warnings } — never throws for a
   club with missing detail, because a club with no logo and no short name is
   an ordinary Tuesday and must still get a product.
   ========================================================================== */
function build(club, opts) {
  club = club || {};
  const kind = (opts && opts.kind) || 'tee';
  const spec = (opts && opts.sheet) || SHEETS[kind];
  if (!spec) throw new Error('no print sheet for "' + kind + '"');
  const design = DESIGNS[kind];
  if (!design) throw new Error('no design for "' + kind + '"');

  const W = inch(spec.w), H = inch(spec.h);
  const pad = Math.round(Math.min(W, H) * spec.safe);
  const S = { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2 };
  S.cx = S.x + S.w / 2;

  /* THE INK IS NOT THE CLUB COLOUR BY DEFAULT. Garments are dark here, and a
     dark navy crest on a black shirt is a crest nobody can see. The club's
     colour is offered as an override for anyone printing on white. */
  const ink = (opts && opts.ink) || '#FFFFFF';

  const warnings = [];
  if (!club.logoDataUri) {
    warnings.push({ level: 'info', text:
      'No approved logo for this club, so the monogram is printed. Approving a ' +
      'logo in the console replaces it and the design regenerates.' });
  } else {
    const drawn = Math.min(spec.w, spec.h) * 0.55;
    const r = checkResolution(
      { width: club.logoWidth, height: club.logoHeight }, drawn);
    if (r) warnings.push(r);
  }
  if (!club.name) warnings.push({ level: 'warn', text: 'This club has no name to print.' });

  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    /* No background rectangle, deliberately: the sheet is transparent, because
       the factory prints onto the garment and a white box would print as a
       white box. */
    `<title>${esc(club.name || 'Club')} — ${esc(spec.label || kind)}</title>` +
    design(club, S, ink) +
    `</svg>`;

  return { svg, width: W, height: H, dpi: DPI, kind, sheet: spec, ink, warnings };
}

const KINDS = Object.keys(SHEETS);

return { build, KINDS, SHEETS, monogram, checkResolution, DPI };
}));
