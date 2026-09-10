'use strict';
/* ============================================================================
   Team colour — a club's two brand colours, made safe to read on the page.

   The colours come from the team row (teams.colour / colour_2, read from the crest by the
   ingest — scripts/ingest/team_colours.py) and are painted as CSS variables:

     --team-a / --team-b        the colours as the club has them
     --team-a-ink / --team-b-ink  the same colours as TEXT on the dark ground: a navy or a
                                black is lifted until it clears WCAG AA (4.5:1) against the
                                page, a gold or a white is left alone
     --team-on-a / --team-on-b  text ON a surface filled with the colour — near-black or
                                white, whichever contrasts more

   fromImage(url) is the browser-side fallback for a crest the ingest has not read yet (a
   club's own upload, before the nightly pass): the same frequency count as the Python, on a
   canvas. It needs the image to be CORS-readable, which the media-public bucket is and the
   FIBA image host is not — those are coloured by the ingest and arrive on the row.
   ============================================================================ */
(function () {
  const GROUND = '#04100b';

  const parse = hex => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const toHex = rgb => '#' + rgb.map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
  const lum = rgb => {
    const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  };
  const contrast = (a, b) => { const la = lum(a) + 0.05, lb = lum(b) + 0.05; return la > lb ? la / lb : lb / la; };
  const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);

  /* the page's ground, which the light theme turns pale: on it a club colour is pulled
     towards black to read, not towards white */
  const LIGHT_GROUND = '#f3faf6';
  const light = () => typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'light';
  const ground = () => (light() ? LIGHT_GROUND : GROUND);
  /* the colour as text on the ground: nudged in small steps, until it reads */
  function ink(hex) {
    let c = parse(hex); if (!c) return null;
    const g = parse(ground());
    const towards = light() ? [0, 0, 0] : [255, 255, 255];
    for (let i = 0; i < 24 && contrast(c, g) < 4.5; i++) c = mix(c, towards, 0.09);
    return toHex(c);
  }
  /* text on a surface of this colour */
  function on(hex) {
    const c = parse(hex); if (!c) return GROUND;
    return contrast(c, parse(GROUND)) >= contrast(c, [255, 255, 255]) ? GROUND : '#ffffff';
  }
  /* a second colour when the crest had only one: the same hue, clearly lighter or darker */
  function derived(hex) {
    const c = parse(hex); if (!c) return null;
    return toHex(lum(c) > 0.3 ? mix(c, parse(GROUND), 0.55) : mix(c, [255, 255, 255], 0.45));
  }

  function apply(root, a, b) {
    root = root || document.documentElement;
    const A = parse(a) ? toHex(parse(a)) : null;
    if (!A) return false;
    const B = parse(b) ? toHex(parse(b)) : derived(A);
    const s = root.style;
    s.setProperty('--team-a', A);           s.setProperty('--team-b', B);
    s.setProperty('--team-a-ink', ink(A));  s.setProperty('--team-b-ink', ink(B));
    s.setProperty('--team-on-a', on(A));    s.setProperty('--team-on-b', on(B));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', toHex(mix(parse(A), parse(GROUND), 0.7)));
    return true;
  }

  /* A CARD IN THE CLUB'S INK. The print-style cards (kit/card.css: the club grid, the stars
     of the month, the Team of the Year) read one input, --ink-c. They now read four: the
     raw primary for the flood and halftone, the secondary for the band and registration
     marks, and the text-safe ink of each for anything that has to be read. */
  function card(elm, a, b) {
    const A = parse(a) ? toHex(parse(a)) : '#93f2bf';
    const B = parse(b) ? toHex(parse(b)) : derived(A);
    const s = elm.style;
    s.setProperty('--ink-c', A);      s.setProperty('--ink-c2', B);
    s.setProperty('--ink-t', ink(A)); s.setProperty('--ink-t2', ink(B));
    s.setProperty('--ink-on2', on(B));
  }

  /* ---------------------------------------------------- the same count, in the browser --- */
  function hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    const s = d < 1e-6 ? 0 : d / (1 - Math.abs(2 * l - 1) + 1e-9);
    let h = 0;
    if (d >= 1e-6) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, Math.min(1, s), l];
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 255;

  function palette(px) {                     /* px: array of [r,g,b] opaque pixels */
    if (px.length < 20) return null;
    const whiteish = px.filter(p => Math.min(p[0], p[1], p[2]) > 235).length / px.length;
    if (whiteish > 0.35) px = px.filter(p => Math.min(p[0], p[1], p[2]) <= 235);
    const total = px.length, byKey = new Map();
    px.forEach(p => {
      const k = ((p[0] >> 4) << 8) | ((p[1] >> 4) << 4) | (p[2] >> 4);
      const e = byKey.get(k) || { n: 0, sum: [0, 0, 0] };
      e.n++; e.sum[0] += p[0]; e.sum[1] += p[1]; e.sum[2] += p[2];
      byKey.set(k, e);
    });
    const bins = [...byKey.values()].map(e => ({ rgb: e.sum.map(v => v / e.n), n: e.n })).sort((x, y) => y.n - x.n);
    const merged = [];
    bins.forEach(b => {
      const m = merged.find(m => dist(m.seed, b.rgb) < 0.13);
      if (m) { const w = m.n + b.n; m.rgb = m.rgb.map((c, i) => (c * m.n + b.rgb[i] * b.n) / w); m.n = w; }
      else merged.push({ rgb: b.rgb, n: b.n, seed: b.rgb });
    });
    merged.forEach(m => {
      const [h, s, l] = hsl(m.rgb[0], m.rgb[1], m.rgb[2]);
      m.h = h; m.s = s; m.l = l; m.share = m.n / total;
      m.chromatic = s >= 0.25 && l >= 0.12 && l <= 0.80;
    });
    let list = merged.filter(m => m.share >= 0.03); if (!list.length) list = merged.slice(0, 2);
    const rank = m => m.share * (0.6 + (m.chromatic ? m.s : 0));
    const best = arr => arr.reduce((a, m) => (a == null || rank(m) > rank(a) ? m : a), null);
    const primary = best(list.filter(m => m.chromatic)) || best(list);
    const different = m => {
      if (m === primary) return false;
      if (m.chromatic && primary.chromatic) {
        let dh = Math.abs(m.h - primary.h); dh = Math.min(dh, 360 - dh);
        return dh >= 35 || Math.abs(m.l - primary.l) >= 0.30;
      }
      return Math.abs(m.l - primary.l) >= 0.30 || dist(m.rgb, primary.rgb) >= 0.35;
    };
    /* a present colour outranks black/white/grey in both slots: the ground is never the identity */
    const second = best(list.filter(m => different(m) && m.chromatic)) || best(list.filter(different));
    return { primary: toHex(primary.rgb), secondary: second ? toHex(second.rgb) : null };
  }

  function fromImage(url) {
    return new Promise(resolve => {
      if (!url) return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const k = Math.min(1, 96 / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
          const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0, w, h);
          const d = cx.getImageData(0, 0, w, h).data, px = [];
          for (let i = 0; i < d.length; i += 4) if (d[i + 3] >= 204) px.push([d[i], d[i + 1], d[i + 2]]);
          resolve(palette(px));
        } catch (_) { resolve(null); }       /* a tainted canvas: not ours to read */
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  window.EpinoiaTeamColour = { apply, card, ink, on, derived, fromImage, palette, contrast: (a, b) => contrast(parse(a), parse(b)) };
})();
