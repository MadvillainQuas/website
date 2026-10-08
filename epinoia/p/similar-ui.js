'use strict';
/* ============================================================================
   SIMILAR PLAYERS, ON THE PROFILE (the panel that takes the league percentile bars' place).

     EpinoiaSimilarUI.load(competitionId, playerId)   the player-season's one small file (tools/build-similar.mjs), or null
     EpinoiaSimilarUI.prefetch(competitionId, playerId)   the same, asked for early (the button's hover) and kept
     EpinoiaSimilarUI.render({ file, name, locked, teaser })   the panel: { node, setAll(open) }

   NOTHING IS WORKED OUT HERE. The builder compared every player-season with every other once (epinoia/similar.js has
   the rules) and wrote each player a list of the twelve nearest, with the numbers behind every match, so a page reads about 4 KB
   and draws it. A line the builder has not met yet (a game since the last build, a first appearance) has no file, and
   the panel says so rather than guess.

   A ROW is one match: how close (the whole, then style / efficiency / rebounding and defence), and, opened, every
   measure the match was made on, the two players side by side on the pool's own scale. The share of minutes at each
   position is drawn as one stripe a player. `locked` hides the measures that come from the play-by-play (assisted and
   half-court / transition shares), which are part of a league's analytics, the way the bars above leave them out.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaSimilarUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const SIM = () => root.EpinoiaSimilar;
const el = (t, c, x) => { const n = root.document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const POS = ['PG', 'SG', 'SF', 'PF', 'C'];

/* ---- the file ---- */
const FILES = new Map();
function url(cid, pid) {
  const cfg = root.EPINOIA_CONFIG || {};
  const base = cfg.similarBase || ((cfg.supabaseUrl || '') + '/storage/v1/object/public/snapshots/');
  return base + SIM().filePath(cid, pid).split('/').map(encodeURIComponent).join('/');
}
function load(cid, pid) {
  if (!cid || !pid) return Promise.resolve(null);
  const key = cid + '|' + pid;
  if (!FILES.has(key)) {
    FILES.set(key, fetch(url(cid, pid)).then(r => (r.ok ? r.json() : null)).then(j => (SIM().fileOk(j) ? j : null)).catch(() => null)
      .then(j => { if (!j) FILES.delete(key); return j; }));          // a miss is asked again next time
  }
  return FILES.get(key);
}
const prefetch = (cid, pid) => { load(cid, pid); };

/* ---- one measure: the two values, and where each stands on the pool's scale ---- */
const zPos = (v, st) => (v == null || !st || !(st[1] > 0) ? null : Math.max(0, Math.min(100, ((v - st[0]) / st[1] + 3) / 6 * 100)));
function measure(file, i, mine, theirs, names) {
  const S = SIM(), f = S.FEATURES[i];
  const a = S.unpackValue(i, mine), b = S.unpackValue(i, theirs);
  const row = el('div', 'sm-m');
  row.appendChild(el('div', 'sm-ml', f.label));
  const track = el('div', 'sm-mt');
  const st = file.st && file.st[i] ? [file.st[i][0] / f.mul, file.st[i][1] / f.mul] : null;
  const pa = zPos(a, st), pb = zPos(b, st);
  if (pa != null && pb != null) {
    const gap = el('i', 'sm-gap');
    gap.style.left = Math.min(pa, pb) + '%'; gap.style.width = Math.abs(pa - pb) + '%';
    track.appendChild(gap);
  }
  if (pa != null) { const d = el('b', 'sm-dot me'); d.style.left = pa + '%'; track.appendChild(d); }
  if (pb != null) { const d = el('b', 'sm-dot them'); d.style.left = pb + '%'; track.appendChild(d); }
  row.appendChild(track);
  const va = el('div', 'sm-mv me', S.show(i, a)), vb = el('div', 'sm-mv them', S.show(i, b));
  va.title = names[0]; vb.title = names[1];
  row.append(va, vb);
  return row;
}

/* the share of minutes at each position, one stripe a player */
function stripe(vals, who, cls) {
  const S = SIM(), box = el('div', 'sm-ps ' + cls);
  box.appendChild(el('div', 'sm-psn', who));
  const bar = el('div', 'sm-psb');
  let any = false;
  POS.forEach((p, k) => {
    const v = S.unpackValue(S.IDX['pos_' + p.toLowerCase()], vals[S.IDX['pos_' + p.toLowerCase()]]);
    if (v == null) return;
    any = true;
    if (v <= 0) return;
    const seg = el('span', 'sm-pseg p' + k, v >= 9 ? p + ' ' + Math.round(v) : '');
    seg.style.flexGrow = v; seg.title = p + ' ' + Math.round(v) + '% of minutes';
    bar.appendChild(seg);
  });
  if (!any) { bar.appendChild(el('span', 'sm-pseg none', 'no lineup data')); }
  box.appendChild(bar);
  return box;
}

const band = p => (p == null ? '' : p >= 82 ? 'hi' : p >= 68 ? 'mid' : 'lo');

/* a surname for a narrow column (the full name rides in its title) */
const shortName = s => { const p = String(s || '').trim().split(/\s+/); return p.length > 1 ? p[p.length - 1] : String(s || ''); };

/* WHOSE IS WHOSE (2026-10-08): over the measures, a key in the measures' own columns -- both names with their marks over the
   track, each surname over its own column of figures. This profile's player is a filled dot in the club's colour, the match a
   ring in a colour of its own (kit/similar.css --sm-me / --sm-them): two dark club colours used to make them one grey. */
function key(names) {
  const row = el('div', 'sm-key');
  row.appendChild(el('span', 'sm-k0'));
  const both = el('span', 'sm-kl');
  ['me', 'them'].forEach((c, i) => { const s = el('span', 'sm-kn ' + c, names[i]); s.setAttribute('translate', 'no'); both.appendChild(s); });
  row.appendChild(both);
  ['me', 'them'].forEach((c, i) => {
    const s = el('span', 'sm-kc ' + c, shortName(names[i]));
    s.title = names[i]; s.setAttribute('translate', 'no');
    row.appendChild(s);
  });
  return row;
}

function body(file, n, o) {
  const S = SIM(), wrap = el('div', 'sm-b');
  const names = [o.name || 'This player', n.nm];
  wrap.appendChild(key(names));
  S.GROUPS.forEach((g, gi) => {
    const sec = el('div', 'sm-g');
    const head = el('div', 'sm-gh');
    head.appendChild(el('span', 'sm-gt', g.label));
    const pct = n.g && n.g[gi];
    if (pct != null) {
      head.appendChild(el('span', 'sm-gp ' + band(pct), pct + '%'));
      const tr = el('span', 'sm-gb ' + band(pct)); const fill = el('i'); fill.style.width = pct + '%'; tr.appendChild(fill); head.appendChild(tr);
    } else head.appendChild(el('span', 'sm-gp none', 'not enough in common'));
    sec.appendChild(head);
    const subs = [];
    S.GROUP_FEATURES[g.key].forEach(i => {
      const f = S.FEATURES[i];
      if (f.premium && o.locked) return;
      let s = subs.find(x => x.name === f.sub);
      if (!s) { s = { name: f.sub, list: [] }; subs.push(s); }
      s.list.push(i);
    });
    subs.forEach(s => {
      const blk = el('div', 'sm-sub');
      blk.appendChild(el('div', 'sm-sh', s.name));
      if (s.name === 'positions') {
        blk.appendChild(stripe(file.me.vals, names[0], 'me'));
        blk.appendChild(stripe(n.vals, names[1], 'them'));
      } else {
        const shown = s.list.filter(i => file.me.vals[i] != null || n.vals[i] != null);
        shown.forEach(i => blk.appendChild(measure(file, i, file.me.vals[i], n.vals[i], names)));
        if (!shown.length) blk.appendChild(el('div', 'sm-none', 'no numbers for either player'));
      }
      sec.appendChild(blk);
    });
    if (g.key === 's' && o.locked && o.teaser) { const t = el('div', 'sm-teaser'); t.innerHTML = o.teaser; sec.appendChild(t); }
    wrap.appendChild(sec);
  });
  return wrap;
}

function row(file, n, i, o) {
  const card = el('div', 'sm shut');
  const h = el('button', 'sm-h'); h.type = 'button'; h.setAttribute('aria-expanded', 'false');
  h.appendChild(el('span', 'sm-rank', String(i + 1)));
  const who = el('span', 'sm-who');
  const nm = el('a', 'sm-name', n.nm);
  nm.href = '?p=' + encodeURIComponent(n.p) + '&s=' + encodeURIComponent(n.ss) + '&c=' + encodeURIComponent(n.c);
  nm.addEventListener('click', e => e.stopPropagation());
  nm.setAttribute('translate', 'no');
  who.appendChild(nm);
  const bits = [n.tm, [n.cp, n.ss].filter(Boolean).join(' '), n.ps].filter(Boolean);
  const sub = el('span', 'sm-sub-l', bits.join(' · ') + ' · ' + n.gp + (n.gp === 1 ? ' game' : ' games'));
  sub.setAttribute('translate', 'no');
  who.appendChild(sub);
  h.appendChild(who);
  const chips = el('span', 'sm-chips');
  SIM().GROUPS.forEach((g, gi) => {
    const v = n.g && n.g[gi];
    const c = el('span', 'sm-chip ' + band(v), g.short.toUpperCase() + ' ' + (v == null ? '—' : v));
    c.title = g.label + ': ' + (v == null ? 'not enough in common' : v + '% alike');
    chips.appendChild(c);
  });
  h.appendChild(chips);
  const main = el('span', 'sm-pct ' + band(n.s));
  main.appendChild(el('b', null, n.s + '%'));
  const tr = el('span', 'sm-pt'); const fill = el('i'); fill.style.width = n.s + '%'; tr.appendChild(fill);
  main.appendChild(tr);
  h.appendChild(main);
  h.appendChild(el('span', 'sm-c'));
  card.appendChild(h);
  const bx = el('div', 'sm-bx'), bi = el('div', 'sm-bi');
  bx.appendChild(bi); card.appendChild(bx);
  let drawn = false;
  const set = open => {
    card.classList.toggle('shut', !open); h.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open && !drawn) { drawn = true; bi.appendChild(body(file, n, o)); }
  };
  h.addEventListener('click', () => set(card.classList.contains('shut')));
  card._set = set;
  return card;
}

function render(o) {
  const file = o.file, S = SIM();
  const node = el('div', 'sim');
  const head = el('div', 'sim-head');
  /* the panel's own subtitle, centred with the section title's mark (sectitle.css .sec-sub), not a small label at the left */
  head.appendChild(el('h3', 'sec-sub sim-title', 'similar players'));
  const k = S.FEATURES.filter(f => !(f.premium && o.locked)).length;
  head.appendChild(el('div', 'sim-note', 'closest in style and rates among ' + Number(file.pool).toLocaleString('en-GB') +
    ' player-seasons across every competition here · ' + k + ' measures' + (o.basis ? ' · ' + o.basis : '')));
  const key = el('div', 'sim-key');
  const a = el('span', 'sim-k me', o.name || 'this player'); a.setAttribute('translate', 'no');
  key.append(a, el('span', 'sim-k them', 'the match'));
  head.appendChild(key);
  node.appendChild(head);
  const list = el('div', 'sim-list');
  const cards = (file.n || []).map((n, i) => row(file, n, i, o));
  cards.forEach(c => list.appendChild(c));
  if (!cards.length) list.appendChild(el('div', 'empty', 'No close matches yet.'));
  node.appendChild(list);
  return { node, setAll: open => cards.forEach(c => c._set(open)) };
}

return { load, prefetch, render, url, _test: { zPos, band } };
}));
