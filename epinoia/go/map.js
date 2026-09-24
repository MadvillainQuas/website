'use strict';
/* ============================================================================
   THE FAN'S MAP (go/stamps/): every arena they stamped, pinned and numbered in the order they went, with
   the trips between them drawn - on a real map, as Louie asked (2026-09-24), where journey.js (4.3) drew
   the same journey on a bare grid.

   OpenStreetMap's raster tiles, placed by hand: no library to vendor, nothing in the page but <img>
   elements (the CSP already allows images from https), and the attribution the tiles' licence asks for.
   Fitted to the stamps; + and − zoom about the centre, a drag pans, a double click zooms in. The tiles
   are darkened for the dark theme in go.css.

     EpinoiaGoMap.draw(host, points)   points = [{ lat, lng, name, n }] in the order made
     EpinoiaGoMap.fit(points, w, h)    the zoom and centre that show them all (pure; exported for tests)
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaGoMap = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const TILE = 256, MIN_Z = 2, MAX_Z = 16, PAD = 48;
const TILE_URL = (z, x, y) => 'https://tile.openstreetmap.org/' + z + '/' + x + '/' + y + '.png';

const worldPx = z => TILE * Math.pow(2, z);
const lngX = (lng, z) => (lng + 180) / 360 * worldPx(z);
const latY = (lat, z) => {
  const s = Math.sin(Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldPx(z);
};
const xLng = (x, z) => x / worldPx(z) * 360 - 180;
const yLat = (y, z) => {
  const n = Math.PI - 2 * Math.PI * y / worldPx(z);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

/* the largest zoom at which every point fits inside w x h with a margin, and the centre between them */
function fit(points, w, h) {
  const pts = (points || []).filter(p => p && isFinite(p.lat) && isFinite(p.lng));
  if (!pts.length) return { z: 3, lat: 50, lng: 10 };
  const lats = pts.map(p => p.lat), lngs = pts.map(p => p.lng);
  const box = { n: Math.max(...lats), s: Math.min(...lats), e: Math.max(...lngs), w: Math.min(...lngs) };
  const lat = (box.n + box.s) / 2, lng = (box.e + box.w) / 2;
  if (pts.length === 1) return { z: 13, lat, lng };
  for (let z = MAX_Z; z >= MIN_Z; z--) {
    const dx = lngX(box.e, z) - lngX(box.w, z), dy = latY(box.s, z) - latY(box.n, z);
    if (dx <= w - 2 * PAD && dy <= h - 2 * PAD) return { z: Math.min(z, 14), lat: yLat((latY(box.n, z) + latY(box.s, z)) / 2, z), lng };
  }
  return { z: MIN_Z, lat, lng };
}

function draw(host, points) {
  if (!host || typeof document === 'undefined') return null;
  host.textContent = '';
  host.classList.add('gomap');
  const pts = (points || []).filter(p => p && isFinite(p.lat) && isFinite(p.lng));
  if (!pts.length) {
    const e = document.createElement('div');
    e.className = 'gomap-empty';
    e.textContent = 'Your map fills in as you stamp arenas.';
    host.appendChild(e);
    return null;
  }
  const tiles = document.createElement('div'); tiles.className = 'gomap-tiles';
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg'); svg.setAttribute('class', 'gomap-trips'); svg.setAttribute('aria-hidden', 'true');
  const pins = document.createElement('div'); pins.className = 'gomap-pins';
  const ctl = document.createElement('div'); ctl.className = 'gomap-ctl';
  const attr = document.createElement('a');
  attr.className = 'gomap-attr'; attr.href = 'https://www.openstreetmap.org/copyright'; attr.target = '_blank'; attr.rel = 'noopener';
  attr.textContent = '© OpenStreetMap contributors';
  attr.setAttribute('translate', 'no');
  host.append(tiles, svg, pins, ctl, attr);

  const W = () => host.clientWidth || 600, H = () => host.clientHeight || 400;
  const view = fit(pts, W(), H());
  let z = view.z, cx = lngX(view.lng, z), cy = latY(view.lat, z);     // the centre, in world pixels at z

  // one pin per arena (the numbers of every visit there), in the order first reached
  const byPlace = new Map();
  pts.forEach(p => {
    const k = p.lat.toFixed(5) + ',' + p.lng.toFixed(5);
    const g = byPlace.get(k) || { lat: p.lat, lng: p.lng, name: p.name, ns: [] };
    g.ns.push(p.n);
    byPlace.set(k, g);
  });

  function render() {
    const w = W(), h = H();
    const ox = cx - w / 2, oy = cy - h / 2, n = Math.pow(2, z);
    tiles.textContent = '';
    for (let ty = Math.floor(oy / TILE); ty <= Math.floor((oy + h) / TILE); ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = Math.floor(ox / TILE); tx <= Math.floor((ox + w) / TILE); tx++) {
        const img = document.createElement('img');
        img.alt = '';
        img.draggable = false;
        img.decoding = 'async';
        img.src = TILE_URL(z, ((tx % n) + n) % n, ty);
        img.style.left = (tx * TILE - ox) + 'px';
        img.style.top = (ty * TILE - oy) + 'px';
        tiles.appendChild(img);
      }
    }
    svg.setAttribute('width', w); svg.setAttribute('height', h);
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.textContent = '';
    if (pts.length > 1) {
      const line = document.createElementNS(svgNS, 'polyline');
      line.setAttribute('points', pts.map(p => (lngX(p.lng, z) - ox).toFixed(1) + ',' + (latY(p.lat, z) - oy).toFixed(1)).join(' '));
      line.setAttribute('class', 'gomap-line');
      svg.appendChild(line);
    }
    pins.textContent = '';
    byPlace.forEach(g => {
      const pin = document.createElement('div');
      pin.className = 'gomap-pin';
      pin.style.left = (lngX(g.lng, z) - ox) + 'px';
      pin.style.top = (latY(g.lat, z) - oy) + 'px';
      const b = document.createElement('b');
      b.textContent = g.ns.length > 2 ? g.ns[0] + '…' + g.ns[g.ns.length - 1] : g.ns.join(',');
      pin.appendChild(b);
      pin.title = (g.name || '') + ' · #' + g.ns.join(', #');
      pin.setAttribute('translate', 'no');
      pins.appendChild(pin);
    });
  }

  const zoomTo = (nz, ax, ay) => {
    nz = Math.max(MIN_Z, Math.min(MAX_Z, nz));
    if (nz === z) return;
    const w = W(), h = H();
    // keep the point under (ax, ay) where it is
    const px = cx - w / 2 + (ax == null ? w / 2 : ax), py = cy - h / 2 + (ay == null ? h / 2 : ay);
    const lng = xLng(px, z), lat = yLat(py, z);
    z = nz;
    cx = lngX(lng, z) - (ax == null ? w / 2 : ax) + w / 2;
    cy = latY(lat, z) - (ay == null ? h / 2 : ay) + h / 2;
    render();
  };
  const btn = (label, aria, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.setAttribute('aria-label', aria);
    b.addEventListener('click', fn);
    ctl.appendChild(b);
  };
  btn('+', 'Zoom in', () => zoomTo(z + 1));
  btn('−', 'Zoom out', () => zoomTo(z - 1));
  btn('⤢', 'Show every arena', () => { const v = fit(pts, W(), H()); z = v.z; cx = lngX(v.lng, z); cy = latY(v.lat, z); render(); });

  let drag = null;
  host.addEventListener('pointerdown', e => {
    if (e.target.closest('.gomap-ctl, .gomap-attr')) return;
    drag = { x: e.clientX, y: e.clientY, cx, cy };
    host.setPointerCapture(e.pointerId);
    host.classList.add('dragging');
  });
  host.addEventListener('pointermove', e => {
    if (!drag) return;
    cx = drag.cx - (e.clientX - drag.x);
    cy = drag.cy - (e.clientY - drag.y);
    render();
  });
  const stop = () => { drag = null; host.classList.remove('dragging'); };
  host.addEventListener('pointerup', stop);
  host.addEventListener('pointercancel', stop);
  host.addEventListener('dblclick', e => {
    const r = host.getBoundingClientRect();
    zoomTo(z + 1, e.clientX - r.left, e.clientY - r.top);
  });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => render()).observe(host);
  render();
  return { z: () => z, center: () => ({ lat: yLat(cy, z), lng: xLng(cx, z) }) };
}

return { draw, fit, lngX, latY };
}));
