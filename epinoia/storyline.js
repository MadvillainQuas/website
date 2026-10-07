'use strict';
/* ============================================================================
   EpinoiaStoryline - THE GAME'S STORYLINES (2026-10-07).

     const deck = EpinoiaStoryline.mount(videoHost, { tr });   // the drawer at the foot of the video
     const board = EpinoiaStoryline.board(host, { tr });        // the team board: four factors, shooting, the flow
     M.embedGame(box, gameId, { story: s => { deck.update(s); board.update(s); } });  // the box score frame works it out

   THE DRAWER. At rest it is a lip: a translucent tab rising from just under the video's bottom edge, in the middle (where
   YouTube's control bar has nothing), with the line that matters most now - a run as it happens, a player's streak,
   the leading scorer. A pointer resting on it slides the drawer up over the foot of the picture; leaving lets it fall
   back. A press (or a tap: a phone has no hover) keeps it up until it is closed.

   THE STORYLINES, each a card, each switched on or off by its chip (remembered on this device):
     LEADERS        the leading scorers, three a side, with their shooting
     BPM            the game's best by box plus/minus (bpm.js game(), five minutes or more)
     RUNS           a run as it happens (6-0 or more, unanswered) as a graphic in the side's colour, a player's streak
                    (6 or more of his side's points in a row), the game's biggest run, and the margin worm: the lead over
                    the whole game, the run drawn over it
     FOUR FACTORS   eFG%, turnovers, the offensive glass, free-throw rate - mirrored, the better side lit, the margin
     SHOOTING       2PT, 3PT, FT (and at the rim where the feed places shots), made/attempted and %, each side a bar

   THE BOARD is the team side of the same story, wide and solid, for the room under a desktop's video when the box score
   has gone into the column beside it (home/videohub.js): four factors with their margins, the shooting, the game's flow.

   THE STORY IS NOT READ HERE. The box score frame under the video already holds the game and keeps it live; it works
   the storylines out from its own replay (embed/game storyOf) and posts them up. This only draws.

   THE DRAWER'S SOLIDITY FOLLOWS THE PICTURE (kit/storyline.css). While the stream plays (cinema mode, html.md-cine) it
   is glass - the game shows through, blurred - and it firms up when the stream is paused, when there is reading to do;
   a card under the pointer goes solid and the others step back; the lip is barely there until a run lights it.
   ============================================================================ */
(function () {
  if (window.EpinoiaStoryline) return;
  const OFF_KEY = 'epinoia.story.off';
  const KINDS = [['leaders', 'Leaders'], ['bpm', 'BPM'], ['runs', 'Runs'], ['factors', 'Four factors'], ['shooting', 'Shooting']];
  const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fin = v => typeof v === 'number' && isFinite(v);
  const pct = (m, a) => a > 0 ? Math.round(m / a * 100) : null;
  const HEX = /^#[0-9a-f]{3,8}$|^rgba?\([\d\s.,%]+\)$|^oklch\([\d\s.%/]+\)$/i;
  const inkOf = (s, i) => { const k = s && s.teams && s.teams[i] && s.teams[i].ink; return k && HEX.test(k) ? k : (i ? '#8ff5ff' : '#93f2bf'); };
  const shortOf = (s, i) => (s && s.teams && s.teams[i] && (s.teams[i].short || s.teams[i].name)) || (i ? 'Away' : 'Home');
  let seq = 0;

  function readOff() {
    try { const v = JSON.parse(localStorage.getItem(OFF_KEY) || '[]'); return new Set(Array.isArray(v) ? v : []); } catch (_) { return new Set(); }
  }
  function saveOff(set) { try { localStorage.setItem(OFF_KEY, JSON.stringify([...set])); } catch (_) { /* private mode */ } }

  /* ---- THE CARDS, drawn the same in the drawer and on the board ---- */
  function kit(tr, id) {
    const side2 = (s, i, inner) => '<div class="sl-col" style="--ink:' + inkOf(s, i) + '"><b class="sl-tm" translate="no">' + esc(shortOf(s, i)) + '</b>' + inner + '</div>';
    function leaders(s) {
      const col = i => ((s.leaders || [])[i] || []).map(p =>
        '<div class="sl-ld"><span class="sl-nm" translate="no">' + esc(p.short) + '</span><b class="sl-big">' + p.pts + '</b>' +
        '<small>' + p.fgm + '/' + p.fga + ' ' + esc(tr('FG')) + ' · ' + p.p3m + ' 3P · ' + p.reb + ' ' + esc(tr('R')) + ' · ' + p.ast + ' ' + esc(tr('A')) + '</small></div>').join('') ||
        '<div class="sl-none">' + esc(tr('No points yet')) + '</div>';
      return '<h4>' + esc(tr('Leading scorers')) + '</h4><div class="sl-two">' + side2(s, 0, col(0)) + side2(s, 1, col(1)) + '</div>';
    }
    function bpm(s) {
      const rows = (s.bpm || []);
      if (!rows.length) return '<h4>' + esc(tr('Leading BPM')) + '</h4><div class="sl-none">' + esc(tr('From five minutes played')) + '</div>';
      const top = Math.max(8, ...rows.map(r => Math.abs(r.bpm)));
      return '<h4>' + esc(tr('Leading BPM')) + '</h4>' + rows.map(r =>
        '<div class="sl-bp" style="--ink:' + inkOf(s, r.side) + '"><i class="sl-dot"></i><span class="sl-nm" translate="no">' + esc(r.short) + '</span>' +
        '<span class="sl-div"><i class="' + (r.bpm < 0 ? 'neg' : '') + '" style="--v:' + Math.min(1, Math.abs(r.bpm) / top).toFixed(3) + '"></i></span>' +
        '<b>' + (r.bpm > 0 ? '+' : '') + r.bpm.toFixed(1) + '</b></div>').join('') +
        '<p class="sl-note">' + esc(tr('Game BPM from the box score')) + '</p>';
    }
    function worm(s, tall) {
      const f = s.flow;
      if (!f || !f.pts || f.pts.length < 2) return '';
      const W = 300, H = tall ? 96 : 64, mid = H / 2, len = Math.max(1, f.len);
      const top = Math.max(6, ...f.pts.map(p => Math.abs(p[1])));
      const x = t => (Math.min(len, t) / len * W).toFixed(1), y = m => (mid - m / top * (mid - 4)).toFixed(1);
      /* a step line: the margin holds until the next basket */
      let d = 'M0 ' + mid;
      f.pts.forEach((p, i) => { if (i) d += ' H' + x(p[0]); d += ' V' + y(p[1]); });
      const endX = f.now != null ? x(f.now) : x(f.pts[f.pts.length - 1][0]);
      d += ' H' + endX;
      const area = d + ' V' + mid + ' Z';
      let runPath = '';
      if (s.live && s.run && s.run.from != null) {
        let rd = '', started = false;
        f.pts.forEach(p => { if (p[0] < s.run.from) return; rd += (started ? ' H' + x(p[0]) : 'M' + x(p[0]) + ' ' + y(p[1])) + ' V' + y(p[1]); started = true; });
        if (rd) runPath = '<path class="sl-w-run" d="' + rd + ' H' + endX + '" style="stroke:' + inkOf(s, s.run.side) + '"/>';
      }
      const cid = id + (tall ? 'W' : 'w');
      return '<svg class="sl-worm' + (tall ? ' tall' : '') + '" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
        '<defs><clipPath id="' + cid + 'a"><rect x="0" y="0" width="' + W + '" height="' + mid + '"/></clipPath>' +
        '<clipPath id="' + cid + 'b"><rect x="0" y="' + mid + '" width="' + W + '" height="' + mid + '"/></clipPath></defs>' +
        '<path d="' + area + '" clip-path="url(#' + cid + 'a)" style="fill:' + inkOf(s, 0) + '" class="sl-w-area"/>' +
        '<path d="' + area + '" clip-path="url(#' + cid + 'b)" style="fill:' + inkOf(s, 1) + '" class="sl-w-area"/>' +
        '<line x1="0" x2="' + W + '" y1="' + mid + '" y2="' + mid + '" class="sl-w-zero"/>' +
        '<path d="' + d + '" class="sl-w-line"/>' + runPath +
        (f.now != null ? '<line x1="' + endX + '" x2="' + endX + '" y1="2" y2="' + (H - 2) + '" class="sl-w-now"/>' : '') + '</svg>';
    }
    function leadsNote(s) {
      const f = s.flow || {};
      return f.lead ? '<p class="sl-note" translate="no">' + esc(tr('Biggest lead')) + ' ' + esc(shortOf(s, 0)) + ' +' + (f.lead[0] || 0) + ' · ' + esc(shortOf(s, 1)) + ' +' + (f.lead[1] || 0) +
        (f.changes ? ' · ' + f.changes + ' ' + esc(tr(f.changes === 1 ? 'lead change' : 'lead changes')) : '') + '</p>' : '';
    }
    function runBlocks(s) {
      let big = '';
      if (s.live && s.run) {
        big = '<div class="sl-run" style="--ink:' + inkOf(s, s.run.side) + '"><b>' + s.run.n + '–0</b><span translate="no">' + esc(shortOf(s, s.run.side)) + ' ' + esc(tr('run')) + '</span>' +
          '<small>' + esc(tr('since')) + ' ' + esc(s.run.since) + '</small>' +
          '<small class="sl-run-by" translate="no">' + (s.run.scorers || []).slice(0, 3).map(p => esc(p.short) + ' ' + p.pts).join(' · ') + '</small></div>';
      } else if (s.bestRun) {
        big = '<div class="sl-run past" style="--ink:' + inkOf(s, s.bestRun.side) + '"><b>' + s.bestRun.n + '–0</b><span translate="no">' + esc(shortOf(s, s.bestRun.side)) + '</span>' +
          '<small>' + esc(tr('biggest run')) + ' · ' + esc(s.bestRun.since) + '</small></div>';
      }
      const st = s.live && s.streak ? s.streak : s.bestStreak;
      const streak = st ? '<div class="sl-streak" style="--ink:' + inkOf(s, st.side) + '"><b>' + st.n + '</b><span translate="no">' + esc(st.short) + '</span><small>' +
        esc(s.live && s.streak ? tr('straight points for their side, and counting') : tr('straight points for their side')) + '</small></div>' : '';
      return big || streak ? '<div class="sl-runs">' + big + streak + '</div>' : '';
    }
    function runs(s) {
      return '<h4>' + esc(tr('Runs')) + '</h4>' + (runBlocks(s) || '<div class="sl-none">' + esc(tr('No run of six or more yet')) + '</div>') + worm(s) + leadsNote(s);
    }
    /* the four factors, mirrored, the better side lit and THE MARGIN under each label, in the better side's colour */
    function factors(s) {
      const a = (s.ff || [])[0], b = (s.ff || [])[1];
      if (!a || !b) return '<h4>' + esc(tr('Four factors')) + '</h4><div class="sl-none">—</div>';
      const rows = [['eFG%', 'efg', false], ['TOV%', 'tov', true], ['OREB%', 'orb', false], ['FT rate', 'ftr', false]].map(([label, k, low]) => {
        const x = fin(a[k]) ? a[k] : 0, y = fin(b[k]) ? b[k] : 0, m = Math.max(1, x, y);
        const w0 = low ? x < y : x > y, w1 = low ? y < x : y > x;
        const gap = Math.abs(x - y), by = w0 ? 0 : w1 ? 1 : null;
        return '<div class="sl-ff"><b class="' + (w0 ? 'w' : '') + '" style="--ink:' + inkOf(s, 0) + '">' + x.toFixed(1) + '</b>' +
          '<span class="sl-mir"><i class="l" style="--ink:' + inkOf(s, 0) + ';--v:' + (x / m).toFixed(3) + '"></i>' +
          '<em>' + esc(tr(label)) + (by != null && gap >= 0.05 ? '<s style="--ink:' + inkOf(s, by) + '" translate="no">' + (by ? '' : '◂ ') + '+' + gap.toFixed(1) + (by ? ' ▸' : '') + '</s>' : '') + '</em>' +
          '<i class="r" style="--ink:' + inkOf(s, 1) + ';--v:' + (y / m).toFixed(3) + '"></i></span>' +
          '<b class="' + (w1 ? 'w' : '') + '" style="--ink:' + inkOf(s, 1) + '">' + y.toFixed(1) + '</b></div>';
      }).join('');
      return '<h4>' + esc(tr('Four factors')) + '</h4><div class="sl-ffh" translate="no"><span>' + esc(shortOf(s, 0)) + '</span><span>' + esc(shortOf(s, 1)) + '</span></div>' + rows;
    }
    /* SHOOTING IS THE SHOT PROFILE, as the game page draws it (game/modern.js shotsHTML): at the rim, mid-range, three,
       mirrored about the zone. A bar's LENGTH is the attempts, on one scale for both clubs and all three zones; its solid
       part the makes; at its outer end the FG% (lit where it is the better of the two) and made-attempted; in the middle
       the zone and each club's share of its shots there */
    function shooting(s) {
      const a = (s.shoot || [])[0], b = (s.shoot || [])[1];
      if (!a || !b || !a.rim) return '<h4>' + esc(tr('Shooting')) + '</h4><div class="sl-none">—</div>';
      const ZONES = [['Rim', 'rim'], ['Mid-range', 'mid'], ['Three', 'p3']];
      const z = (o, k) => { const v = o[k] || [0, 0]; return { m: Math.min(+v[0] || 0, +v[1] || 0), a: +v[1] || 0 }; };
      const max = Math.max(1, ...ZONES.map(([, k]) => Math.max(z(a, k).a, z(b, k).a)));
      const fga = [Math.max(1, a.fga || 0), Math.max(1, b.fga || 0)];
      const fig = (i, o, x) => { const p = pct(o.m, o.a), better = o.a > 0 && (x.a === 0 || o.m / o.a > x.m / x.a);
        return '<span class="sl-szf' + (i ? ' r' : '') + (better ? ' w' : '') + '" style="--ink:' + inkOf(s, i) + '"><b>' + (p == null ? '–' : p + '%') + '</b><i>' + o.m + '-' + o.a + '</i></span>'; };
      const bar = (i, o) => '<span class="sl-szb' + (i ? ' r' : ' l') + '"><span class="sl-szt" style="--ink:' + inkOf(s, i) + ';--a:' + (o.a / max * 100).toFixed(1) + '%;--m:' +
        (o.a ? o.m / o.a * 100 : 0).toFixed(1) + '%"><i></i></span></span>';
      return '<h4>' + esc(tr('Shooting')) + '</h4><div class="sl-ffh" translate="no"><span>' + esc(shortOf(s, 0)) + '</span><span>' + esc(shortOf(s, 1)) + '</span></div>' +
        ZONES.map(([label, k]) => { const h = z(a, k), w = z(b, k);
          return '<div class="sl-sz">' + fig(0, h, w) + bar(0, h) + '<span class="sl-szm"><b>' + esc(tr(label)) + '</b><span>' +
            '<em style="--ink:' + inkOf(s, 0) + '">' + Math.round(h.a / fga[0] * 100) + '%</em> ' + esc(tr('of shots')) + ' <em style="--ink:' + inkOf(s, 1) + '">' +
            Math.round(w.a / fga[1] * 100) + '%</em></span></span>' + bar(1, w) + fig(1, w, h) + '</div>'; }).join('') +
        '<p class="sl-note">' + esc(tr('Bar = shots taken · solid = made')) + '</p>';
    }
    /* the board's flow: the margin over the whole game, tall, with the runs and the leads beside it */
    function flow(s) {
      return '<h4>' + esc(tr('Game flow')) + '</h4>' + worm(s, true) + runBlocks(s) + leadsNote(s);
    }
    return { leaders, bpm, runs, factors, shooting, flow };
  }

  function mount(host, opts) {
    opts = opts || {};
    const tr = typeof opts.tr === 'function' ? opts.tr : (s => s);
    const id = 'sl' + (++seq);
    const CARD = kit(tr, id);
    const root = document.createElement('div');
    root.className = 'sl';
    root.dataset.open = '0';
    root.innerHTML =
      '<button type="button" class="sl-lip" aria-expanded="false" aria-controls="' + id + '">' +
        '<span class="sl-lip-a" aria-hidden="true"></span><span class="sl-lip-k">' + esc(tr('Storylines')) + '</span><span class="sl-lip-t"></span></button>' +
      '<section class="sl-panel" id="' + id + '" aria-label="' + esc(tr('Storylines of the game')) + '">' +
        '<div class="sl-head"><div class="sl-chips" role="group" aria-label="' + esc(tr('Storylines to show')) + '"></div>' +
          '<button type="button" class="sl-x" aria-label="' + esc(tr('Close the storylines')) + '" title="' + esc(tr('Close')) + '"></button></div>' +
        '<div class="sl-cards"></div>' +
      '</section>';
    host.appendChild(root);
    const lip = root.querySelector('.sl-lip'), lipT = root.querySelector('.sl-lip-t');
    const panel = root.querySelector('.sl-panel'), chips = root.querySelector('.sl-chips'), cards = root.querySelector('.sl-cards');
    const off = readOff();
    let story = null, pinned = false, open = false, closeT = null, alertT = null, lastAlert = '', hotBefore = false;

    /* ---- the chips: a storyline on or off ---- */
    KINDS.forEach(([k, label]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'sl-chip'; b.dataset.k = k; b.textContent = tr(label);
      b.setAttribute('aria-pressed', String(!off.has(k)));
      b.addEventListener('click', () => {
        if (off.has(k)) off.delete(k); else off.add(k);
        saveOff(off);
        b.setAttribute('aria-pressed', String(!off.has(k)));
        draw();
      });
      chips.appendChild(b);
    });

    /* ---- open and shut: a resting pointer opens it and leaving lets it fall; a press keeps it up ---- */
    const hover = () => !!(window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches);
    function setOpen(on, pin) {
      clearTimeout(closeT);
      open = !!on;
      if (pin != null) pinned = !!pin;
      root.dataset.open = open ? '1' : '0';
      root.classList.toggle('pinned', open && pinned);
      lip.setAttribute('aria-expanded', String(open));
      panel.inert = !open;
    }
    panel.inert = true;
    lip.addEventListener('click', () => { if (open && pinned) setOpen(false, false); else setOpen(true, true); });
    lip.addEventListener('mouseenter', () => { if (hover() && !open) setOpen(true, false); });
    root.addEventListener('mouseenter', () => clearTimeout(closeT));
    root.addEventListener('mouseleave', () => {
      if (!hover() || pinned || !open) return;
      clearTimeout(closeT);
      /* not while the drawer is under the pointer: as the lip ducks away and the drawer rises into its place, the
         pointer is over neither for a moment, and that is not leaving */
      closeT = setTimeout(() => { if (!pinned && !panel.matches(':hover') && !lip.matches(':hover')) setOpen(false); }, 650);
    });
    /* a press inside the drawer (a chip, a card) keeps it up: the reader is using it */
    panel.addEventListener('click', e => { if (open && !pinned && !e.target.closest('.sl-x')) setOpen(true, true); });
    root.querySelector('.sl-x').addEventListener('click', () => { setOpen(false, false); try { lip.focus({ preventScroll: true }); } catch (_) { /* old */ } });
    root.addEventListener('keydown', e => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false, false); try { lip.focus({ preventScroll: true }); } catch (_) { /* old */ } } });

    /* ---- the line on the lip: what matters most now ---- */
    function headline(s) {
      if (!s || s.empty) return { t: tr('from the first basket'), side: null };
      if (s.live && s.run) return { t: shortOf(s, s.run.side) + ' ' + s.run.n + '–0 ' + tr('run'), side: s.run.side, alert: 'run' };
      if (s.live && s.streak) return { t: s.streak.short + ' · ' + s.streak.n + ' ' + tr('straight'), side: s.streak.side, alert: 'streak' };
      const all = (s.leaders || []).flat().sort((a, b) => b.pts - a.pts);
      if (all[0]) return { t: all[0].short + ' ' + all[0].pts + ' ' + tr('pts'), side: all[0].side };
      return { t: '', side: null };
    }
    /* A RUN OR A STREAK AS IT HAPPENS LIGHTS THE LIP for a while, in the side's colour, drawer up or not */
    function alertFor(s, h) {
      if (!h.alert) return;
      const key = h.alert + ':' + (h.alert === 'run' ? s.run.side + ':' + s.run.since + ':' + s.run.n : s.streak.short + ':' + s.streak.n);
      if (key === lastAlert) return;
      lastAlert = key;
      root.classList.remove('sl-alert');
      void root.offsetWidth;
      root.classList.add('sl-alert');
      clearTimeout(alertT);
      alertT = setTimeout(() => root.classList.remove('sl-alert'), 9000);
    }

    function draw() {
      const s = story;
      const h = headline(s);
      lipT.textContent = h.t;
      root.style.setProperty('--sl-ink', h.side == null ? 'var(--lume, #93f2bf)' : inkOf(s, h.side));
      if (s && !s.empty) alertFor(s, h);
      const keep = cards.scrollLeft;
      let on = KINDS.map(k => k[0]).filter(k => !off.has(k));
      /* a run or a streak happening now: RUNS first, so the lip lit by it opens onto it */
      const hot = !!(s && s.live && (s.run || s.streak));
      if (hot && on.includes('runs')) on = ['runs'].concat(on.filter(k => k !== 'runs'));
      if (!s || s.empty) cards.innerHTML = '<div class="sl-wait">' + esc(tr('The storylines fill in from the first basket.')) + '</div>';
      else if (!on.length) cards.innerHTML = '<div class="sl-wait">' + esc(tr('Switch a storyline on above.')) + '</div>';
      else cards.innerHTML = on.map(k => { let inner = ''; try { inner = CARD[k](s); } catch (_) { inner = ''; } return inner ? '<article class="sl-card" data-k="' + k + '">' + inner + '</article>' : ''; }).join('');
      cards.scrollLeft = hot && !hotBefore ? 0 : keep;
      hotBefore = hot;
    }
    draw();

    return {
      el: root,
      update(s) { if (!s || typeof s !== 'object') return; story = s; draw(); },
      reset() { story = null; lastAlert = ''; root.classList.remove('sl-alert'); setOpen(false, false); draw(); },
      stop() { clearTimeout(closeT); clearTimeout(alertT); root.remove(); }
    };
  }

  /* THE BOARD: the team side of the story, wide and solid - four factors with their margins, the shooting, the flow */
  function board(host, opts) {
    opts = opts || {};
    const tr = typeof opts.tr === 'function' ? opts.tr : (s => s);
    const CARD = kit(tr, 'slb' + (++seq));
    const root = document.createElement('div');
    root.className = 'slb';
    host.appendChild(root);
    let story = null;
    function draw() {
      const s = story;
      if (!s || s.empty) { root.innerHTML = '<div class="sl-wait">' + esc(tr('The team stats fill in from the first basket.')) + '</div>'; return; }
      root.innerHTML = ['factors', 'shooting', 'flow'].map(k => { let inner = ''; try { inner = CARD[k](s); } catch (_) { inner = ''; }
        return inner ? '<article class="slb-card" data-k="' + k + '">' + inner + '</article>' : ''; }).join('');
    }
    draw();
    return {
      el: root,
      update(s) { if (!s || typeof s !== 'object') return; story = s; draw(); },
      reset() { story = null; draw(); },
      stop() { root.remove(); }
    };
  }

  window.EpinoiaStoryline = { mount, board };
})();
