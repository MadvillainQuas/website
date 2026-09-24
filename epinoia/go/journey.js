'use strict';
/* ============================================================================
   A FAN'S JOURNEY, DRAWN (EPINOIA GO step 4.3, docs/epinoia-go.md; D10).

   Our own SVG, no map library and no key in the page: the arenas a fan has stamped as points, the
   journey as lines from each stamp's arena to the next one's in the order made (the distance the
   leaderboards count, D2), fitted to the arenas with a light grid of latitude and longitude and a
   scale bar. Every point opens its arena in Google Maps.

   An equirectangular projection with longitude shrunk by the cosine of the middle latitude: at the
   size of a league's country it is the shape a reader expects, and it is a few lines of arithmetic.

   build(stamps) -> { w, h, points, segments, grid, scale } is pure (tested under Node);
   draw(host, stamps) renders it.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaJourney = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const W = 640;                 // the drawing's width in its own units; the height follows the arenas' shape
const PAD = 0.12;              // a margin round the arenas, as a share of the span
const MIN_SPAN = 0.08;         // degrees: one arena, or two across a town, still draws as a place

function metres(a, b) {
  const r = x => x * Math.PI / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 +
            Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* a round number of degrees for the grid, about four or five lines across the span */
function step(span) {
  const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 45];
  return steps.find(s => span / s <= 5) || 45;
}

/* a round distance for the scale bar, about a fifth of the width */
function scaleKm(kmAcross) {
  const want = kmAcross / 5;
  const nice = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  return nice.reduce((best, n) => (Math.abs(n - want) < Math.abs(best - want) ? n : best), nice[0]);
}

/* stamps: [{ venue_id, name, lat, lng, stamped_at }] in any order; those without a pin are left out */
function build(stamps) {
  const s = (stamps || []).filter(x => x && x.lat != null && x.lng != null && isFinite(x.lat) && isFinite(x.lng))
    .slice().sort((a, b) => String(a.stamped_at).localeCompare(String(b.stamped_at)));
  if (!s.length) return null;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  s.forEach(x => { minLat = Math.min(minLat, x.lat); maxLat = Math.max(maxLat, x.lat);
                   minLng = Math.min(minLng, x.lng); maxLng = Math.max(maxLng, x.lng); });
  const midLat = (minLat + maxLat) / 2;
  const k = Math.max(Math.cos(midLat * Math.PI / 180), 0.2);      // a degree of longitude, in latitude's units
  let spanLat = Math.max(maxLat - minLat, MIN_SPAN);
  let spanLng = Math.max((maxLng - minLng) * k, MIN_SPAN);
  // no thinner than 2:1 either way: a journey along one road still has room round it
  spanLat = Math.max(spanLat, spanLng / 2);
  spanLng = Math.max(spanLng, spanLat / 2);
  const cLat = (minLat + maxLat) / 2, cLng = (minLng + maxLng) / 2;
  const fullLat = spanLat * (1 + 2 * PAD), fullLngK = spanLng * (1 + 2 * PAD);
  const h = Math.round(W * fullLat / fullLngK);
  const x = lng => (((lng - cLng) * k) / fullLngK + 0.5) * W;
  const y = lat => (0.5 - (lat - cLat) / fullLat) * h;

  // one point per arena, however many stamps: the visits counted, the first and last marked
  const byVenue = new Map();
  s.forEach((st, i) => {
    const key = st.venue_id || (st.lat + ',' + st.lng);
    const p = byVenue.get(key) || { venue_id: st.venue_id, name: st.name || '', lat: st.lat, lng: st.lng,
                                    x: +x(st.lng).toFixed(1), y: +y(st.lat).toFixed(1), visits: 0, first: i, last: i };
    p.visits++;
    p.last = i;
    byVenue.set(key, p);
  });
  const points = [...byVenue.values()];
  const segments = [];
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1], b = s[i];
    if (a.lat === b.lat && a.lng === b.lng) continue;                    // a second visit adds no line
    segments.push({ x1: +x(a.lng).toFixed(1), y1: +y(a.lat).toFixed(1), x2: +x(b.lng).toFixed(1), y2: +y(b.lat).toFixed(1),
                    km: metres(a, b) / 1000 });
  }
  const loLat = cLat - fullLat / 2, hiLat = cLat + fullLat / 2;
  const loLng = cLng - fullLngK / k / 2, hiLng = cLng + fullLngK / k / 2;
  const gs = step(Math.max(hiLat - loLat, (hiLng - loLng) * k));
  const grid = { lat: [], lng: [] };
  for (let v = Math.ceil(loLat / gs) * gs; v <= hiLat; v += gs) grid.lat.push({ v: +v.toFixed(4), y: +y(v).toFixed(1) });
  for (let v = Math.ceil(loLng / gs) * gs; v <= hiLng; v += gs) grid.lng.push({ v: +v.toFixed(4), x: +x(v).toFixed(1) });
  const kmAcross = metres({ lat: cLat, lng: loLng }, { lat: cLat, lng: hiLng }) / 1000;
  const km = scaleKm(kmAcross);
  const scale = { km, px: +(W * km / kmAcross).toFixed(1) };
  return { w: W, h, points, segments, grid, scale, stamps: s.length, labels: place(points, W, h) };
}

/* the width a name takes at 12px: a CJK character about twice a Latin one */
function textWidth(t) {
  let w = 0;
  for (const ch of t) w += /[⺀-鿿가-힯豈-﫿＀-￯]/.test(ch) ? 12 : 6.6;
  return w + 4;
}

/* Names for the most visited arenas, none over another or off the edge: beside the point (on its left near
   the right edge), else below it, else above it, else not at all - the point keeps its tooltip and link. */
function place(points, w, h) {
  const boxes = [];
  const clash = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const dots = points.map(p => ({ x0: p.x - 6, x1: p.x + 6, y0: p.y - 6, y1: p.y + 6 }));
  const out = [];
  points.slice().sort((a, b) => b.visits - a.visits || a.first - b.first).slice(0, 10).forEach(p => {
    const text = p.name.length > 24 ? p.name.slice(0, 23) + '…' : p.name;
    const tw = textWidth(text);
    const left = p.x + 9 + tw > w;                                      // no room to the right
    for (const dy of [4, 18, -10]) {
      const x = left ? p.x - 9 : p.x + 9;
      const box = { x0: left ? x - tw : x, x1: left ? x : x + tw, y0: p.y + dy - 11, y1: p.y + dy + 3 };
      if (box.x0 < 0 || box.x1 > w || box.y0 < 0 || box.y1 > h - 24) continue;   // the scale bar lives at the foot
      if (boxes.some(b => clash(b, box)) || dots.some(d => clash(d, box))) continue;
      boxes.push(box);
      out.push({ text, x: +x.toFixed(1), y: +(p.y + dy).toFixed(1), anchor: left ? 'end' : 'start', venue_id: p.venue_id });
      return;
    }
  });
  return out;
}

const NS = 'http://www.w3.org/2000/svg';
const svg = (t, a) => { const n = document.createElementNS(NS, t); Object.entries(a || {}).forEach(([k, v]) => n.setAttribute(k, v)); return n; };

function mapsUrl(p) {
  return 'https://www.google.com/maps/search/?api=1&query=' + p.lat + ',' + p.lng;
}

/* draw the journey into host; returns the plan, or null when no stamped arena has a pin */
function draw(host, stamps, opts) {
  const plan = build(stamps);
  host.textContent = '';
  if (!plan) return null;
  const o = opts || {};
  const root = svg('svg', { viewBox: '0 0 ' + plan.w + ' ' + plan.h, class: 'go-map', role: 'img',
                            'aria-label': o.label || 'Your journey' });
  root.appendChild(svg('rect', { x: 0, y: 0, width: plan.w, height: plan.h, class: 'go-map-bg' }));
  plan.grid.lat.forEach(g => root.appendChild(svg('line', { x1: 0, x2: plan.w, y1: g.y, y2: g.y, class: 'go-map-grid' })));
  plan.grid.lng.forEach(g => root.appendChild(svg('line', { y1: 0, y2: plan.h, x1: g.x, x2: g.x, class: 'go-map-grid' })));
  plan.segments.forEach(sg => root.appendChild(svg('line', { x1: sg.x1, y1: sg.y1, x2: sg.x2, y2: sg.y2, class: 'go-map-trip' })));
  plan.points.forEach(p => {
    const a = svg('a', { href: mapsUrl(p), target: '_blank', rel: 'noopener noreferrer' });
    const title = svg('title');
    title.textContent = p.name + (p.visits > 1 ? ' · ' + p.visits : '');
    a.appendChild(title);
    a.appendChild(svg('circle', { cx: p.x, cy: p.y, r: 5 + Math.min(p.visits - 1, 4), class: 'go-map-pt' + (p.last === plan.stamps - 1 ? ' last' : '') }));
    root.appendChild(a);
  });
  plan.labels.forEach(l => {
    const t = svg('text', { x: l.x, y: l.y, 'text-anchor': l.anchor, class: 'go-map-label', translate: 'no' });
    t.textContent = l.text;
    root.appendChild(t);
  });
  const sy = plan.h - 14;
  root.appendChild(svg('line', { x1: 14, x2: 14 + plan.scale.px, y1: sy, y2: sy, class: 'go-map-scale' }));
  const st = svg('text', { x: 14, y: sy - 6, class: 'go-map-label', translate: 'no' });
  st.textContent = plan.scale.km + ' km';
  root.appendChild(st);
  host.appendChild(root);
  return plan;
}

return { build, draw, step, scaleKm, metres, textWidth };
}));
