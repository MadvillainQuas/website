'use strict';
/* ============================================================================
   HOME — EPINOIA GO, under the feed (2026-10-04).

   The GO page's own pieces, drawn by go.js (home()) in this section's hosts:
     - the two pills, "Games open to stamp now" and "Today and tomorrow": a hover or a press lists those games,
       the teams, the arena, and how far each one is (a press asks the phone where it is; a hover only uses a
       location this site already has), with the stamp itself a link to the GO page;
     - the arenas in the reader's country they have not stamped yet, sliding past (the country is the GO page's
       choice, kept in this browser, and can be changed here), an arena with a game open to stamp now lit up,
       the game shown under a pointer;
     - JUST STAMPED (Louie, 2026-10-08; go_stamps_latest, 0258): every stamp, newest first, as GO's stamp cards -
       a fan who went public by their username, everybody else as "a fan", the reader's own as "you", with how long
       ago. Read again every minute while the page is in view; a stamp new since the last look comes down onto the
       row. None yet: one line inviting the first. Before 0258 is on the server the row stays away.
   The title and "open EPINOIA GO" go to the GO page. The section stays shut when EPINOIA GO is not open.
   ============================================================================ */
(function () {
  const H = window.EpinoiaHome;
  if (!H) return;
  const EVERY_MS = 60000;
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };

  /* the newest stamps; the reader's session (follow.js's) only so that their own read as "you" */
  async function latest() {
    const C = window.EPINOIA_CONFIG || {};
    if (!C.supabaseUrl) return null;
    const F = window.EpinoiaFollow, s = F && typeof F.session === 'function' ? F.session() : null;
    const h = { apikey: C.supabaseAnonKey, 'Content-Type': 'application/json' };
    if (s && s.token) h.Authorization = 'Bearer ' + s.token;
    const go = () => fetch(C.supabaseUrl + '/rest/v1/rpc/go_stamps_latest', { method: 'POST', cache: 'no-store', headers: h, body: JSON.stringify({ p_limit: 10 }) });
    try {
      let r = await go();
      if (r.status === 401 && h.Authorization) { delete h.Authorization; r = await go(); }
      if (r.status === 404) return 'missing';              // before 0258
      return r.ok ? await r.json() : null;
    } catch (_) { return null; }
  }

  function stamps(host, base) {
    const SC = window.EpinoiaGoStampCard;
    if (!host || !SC) return;
    let seen = null, timer = 0;
    const href = row => (row.game_id ? base + 'game/?g=' + encodeURIComponent(row.game_id) + '&mode=supabase' : base + 'go/');
    const draw = rows => {
      host.textContent = '';
      const head = host.appendChild(el('div', 'hm-go-stamps-h'));
      head.appendChild(el('span', 'hm-go-dot'));
      head.appendChild(el('span', null, 'just stamped'));
      if (!rows.length) {
        const p = host.appendChild(el('p', 'hm-go-first'));
        p.appendChild(el('span', null, 'Nobody has stamped an arena yet. Be the first: go to a game and stamp it on EPINOIA GO.'));
        const a = p.appendChild(el('a', null, 'how it works →'));
        a.href = base + 'go/';
        host.hidden = false;
        return;
      }
      const row = host.appendChild(el('div', 'hm-go-stamps-row'));
      rows.forEach(x => {
        const card = SC.build(x, { href: href(x), cls: 'hm-stamp', ago: true });
        if (seen && !seen.has(x.id)) card.classList.add('fresh');
        row.appendChild(card);
      });
      seen = new Set(rows.map(x => x.id));
      host.hidden = false;
    };
    const tick = async () => {
      clearTimeout(timer);
      const rows = await latest();
      if (rows === 'missing') { host.hidden = true; return; }      // the server has not the read yet: no row, no polling
      if (Array.isArray(rows)) draw(rows);
      if (!document.hidden) timer = setTimeout(tick, EVERY_MS);
    };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); else clearTimeout(timer); });
    tick();
  }

  H.register('go', async function (ctx) {
    const sec = document.getElementById('go');
    const G = window.EpinoiaGo;
    if (!sec || !G || typeof G.home !== 'function') return;
    const ok = await G.home({ pills: document.getElementById('homeGoToday'), sec: '#homeGoStripSec',
      pick: '#homeGoCountry', strip: '#homeGoStrip', goHref: ctx.base + 'go/' });
    if (!ok) { sec.hidden = true; return; }
    const pick = document.getElementById('homeGoCountry');
    if (pick && !pick.options.length) pick.hidden = true;            // no arena has a pin anywhere yet
    sec.hidden = false;
    ctx.fadeIn(sec);
    stamps(document.getElementById('homeGoStamps'), ctx.base);
  });
})();
