'use strict';
/* ============================================================================
   HOME — DAILY FIXTURES (roadmap Phase 2), section 'fixtures'.

   THREE TABS: LIVE | UPCOMING | RESULTS (2026-10-01). Each holds one kind of game:
     LIVE      the games in progress (EpinoiaGlobalGames.pickLive: the overdue and stalled guard, followed first).
               The tab is only there while something is live; it slides in when the first game tips off, its badge
               counts the games, and it is the tab a visit opens on whenever anything is live.
     UPCOMING  the games not yet started (pickUpcoming): eight cards, each league's next game within a fortnight
               before the rest by tip-off, what the reader follows first (pickDaily's rules, unchanged).
     RESULTS   the finals, newest first, no league taking more than three of the first eight (pickResults).
   The reader's pick is kept for the visit (sessionStorage). The tab never moves by itself, with one exception: LIVE
   emptying while it is shown falls back to UPCOMING with a line saying why (EpinoiaGlobalGames.dailyTab). A game going
   live while the reader is on UPCOMING lights the LIVE tab and its count, and leaves the reader where they are.

   SHOW MORE: eight more cards a press, up to forty, then the button is the link to the fixtures page; SHOW LESS
   folds back to eight. New cards only ever go at the END (pickUpcoming / pickResults keep the first eight where they
   were), wipe in one after another, the list's height follows them, and focus goes to the first new card. On a phone
   the eight sit in the sideways strip as before; more than eight open into a grid two across. Under reduced motion
   all of it is instant. The reads grow only when a press needs more rows than the first page holds.

   WHAT THE READER FOLLOWS COMES FIRST: their leagues' and clubs' live games lead the LIVE tab, and the next game of
   each league and club they follow takes an UPCOMING card before anybody else's does (follow.js: fan_prefs, signed
   in; nothing followed is everybody's order).

   THE READS: the live games on every tick, whichever tab is shown (the LIVE tab's count is always current); the
   forty scheduled games from two hours ago onwards (kept between ticks until one tips off) and every league's next
   game in one read (EpinoiaGlobalGames.nextAll) for UPCOMING; forty finals for RESULTS.

   KEPT FRESH the way the league front page keeps its games (home.js
   watchGames): every 15 s while a game is live, every 30 s otherwise, and at
   once (with a scatter, so a thousand open pages do not ask in the same
   instant) when rt.js hears the scorer announce a status change on
   'epinoia:live'. The announcement is a nudge to look, never a fact to show.
   The rail is only rebuilt when WHICH games or their scores change, so a
   refresh never throws a reader's sideways scroll back to the start.

   LEAGUES SHOWN AS ONE GROUP (NCAA D2, 2026-10-14; config.js EPINOIA_LEAGUE_GROUPS): no tab's own list holds their
   games. Under it, one closed block per group with a game in that tab ("NCAA D2 · 37 live"), shown like a COUNTRY:
   its parts (Men, Women) inside, their conferences inside those like leagues, the games inside those - each level read
   only when it is opened, and kept open, and read again, through the refreshes. See "THE GROUPS" below.
   ============================================================================ */
(function () {
  const H = window.EpinoiaHome;
  if (!H) return;

  const LIVE_MS = 15000, IDLE_MS = 30000, N = 8;
  /* SHOW MORE: eight a press, forty at most (then the full fixtures page) */
  const STEP = 8, CAP = 40;
  /* LIVE shows its first 20, then SHOW MORE adds 20 at a time, with no cap: every live game is already in hand, so a
     press fetches nothing. UPCOMING and RESULTS keep their eight, then eight a press, to 40. */
  const LIVE_N = 20, LIVE_STEP = 20;
  const firstOf = m => (m === 'live' ? LIVE_N : N);
  const stepOf = m => (m === 'live' ? LIVE_STEP : STEP);
  const capOf = m => (m === 'live' ? Infinity : CAP);
  /* a page of a read: what the upcoming and the results reads ask for at a time */
  const PAGE = 40;

  /* lastKey starts null, not '': an empty day's key is '', and a first successful read after
     a failed launch must still replace front.js's error message with the "no games" one */
  let host = null, base = '../', timer = null, rt = null, lastKey = null, busy = false;
  let seg = null, say = null, lastData = null, liveCount = -1, fellNote = false;

  /* THE TAB: null until the first read decides it; the reader's own pick of this visit, if any */
  const MODE_KEY = 'epinoia_home_fixtures';
  const PER_LEAGUE = 3;
  let mode = null, chosen = null;
  try { const v = sessionStorage.getItem(MODE_KEY); if (v === 'live' || v === 'up' || v === 'res') chosen = v; } catch (_) { /* private mode */ }
  const limit = { live: LIVE_N, up: N, res: N };

  function hidden() { return typeof document !== 'undefined' && document.visibilityState === 'hidden'; }
  function reduced() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (_) { return false; }
  }

  /* THE FORTY UPCOMING GAMES CHANGE WHEN ONE TIPS OFF, not every thirty seconds: a
     game going live is the live read's business. So they are kept between ticks
     and read again once one of them has tipped off since they were read, or after
     two minutes (a fixture the ingest has just added, or one moved).
     MORE THAN A PAGE only when SHOW MORE needs it: the next page is read from the last tip-off held (a keyset, so a game
     going live between the two reads cannot shift an offset and skip one; the game on the seam comes back twice and is
     de-duplicated). */
  const UP_MS = 2 * 60 * 1000;
  /* which leagues the held reads were read without (the groups, read() sets it): a different set is a new read */
  let scopeKey = '';
  let upHeld = null;
  async function upcoming(G, now, need) {
    /* since the read, not before it: the list starts two hours back, so its first game has often tipped off already,
       and a new read would bring the same list back */
    const tipped = upHeld && upHeld.rows.some(g => { const t = Date.parse(g.tipoff_at || ''); return t > upHeld.at && t <= now; });
    if (!upHeld || upHeld.sk !== scopeKey || tipped || now - upHeld.at >= UP_MS) {
      const from = new Date(now - G.STALE_MS).toISOString();
      const rows = await G.upcoming(from, 40);
      upHeld = { at: now, rows, full: rows.length >= PAGE, sk: scopeKey };
    }
    for (let pages = 0; upHeld.full && upHeld.rows.length < (need || 0) && pages < 3; pages++) {
      const last = upHeld.rows[upHeld.rows.length - 1];
      const part = await G.upcoming(last.tipoff_at, PAGE);
      const seen = new Set(upHeld.rows.map(g => g.id));
      const add = part.filter(g => !seen.has(g.id));
      upHeld = { at: upHeld.at, rows: upHeld.rows.concat(add), full: part.length >= PAGE && add.length > 0 };
    }
    return upHeld.rows;
  }

  /* each league's next game: one read for all of them (nextAll), or, where the
     database does not have its view yet, league by league as before */
  async function nextGames(G) {
    const m = typeof G.nextAll === 'function' ? await G.nextAll().catch(() => null) : null;
    if (m) return Array.from(m.values());
    const lgs = await G.leagues().catch(() => []);
    return Promise.all(lgs.map(l => G.nextFor(l.id).catch(() => null)));
  }

  /* the results: finals before now, newest first, forty at a time; the next forty (the same query, offset) only
     when SHOW MORE needs more rows than are held */
  const RES_MS = 60 * 1000;
  let resHeld = null;
  async function results(G, now, need) {
    if (!resHeld || resHeld.sk !== scopeKey || now - resHeld.at > RES_MS) {
      const before = new Date(now).toISOString();
      const rows = await G.recent(new Date(now).toISOString(), 0, 40);
      resHeld = { at: now, before, rows, full: rows.length >= PAGE, sk: scopeKey };
    }
    for (let pages = 0; resHeld.full && resHeld.rows.length < (need || 0) && pages < 3; pages++) {
      const part = await G.recent(resHeld.before, resHeld.rows.length, PAGE);
      const seen = new Set(resHeld.rows.map(g => g.id));
      resHeld = Object.assign({}, resHeld, { rows: resHeld.rows.concat(part.filter(g => !seen.has(g.id))), full: part.length >= PAGE });
    }
    return resHeld.rows;
  }

  /* WHAT THE READER FOLLOWS, through follow.js (never access.js: one read of the fan's row, shared with MY FOLLOWED
     and every bell). Signed out, nothing followed, or no follow.js: null, and the order is everybody's. */
  async function followed() {
    const F = window.EpinoiaFollow;
    if (!F || typeof F.load !== 'function') return null;
    try {
      const p = await F.load();
      if (!p) return null;
      return { leagues: p.fav_league_ids || [], teams: p.fav_team_ids || [] };
    } catch (_) { return null; }
  }

  /* ONE READ: the live games always (the LIVE tab's count), then what the tab shows. `cur` is the tab on screen when
     the read began (null before the first draw); the answer says which tab it drew for. `avail` is how many games
     the tab could show, read one past the shown ones, which is how SHOW MORE knows there is more. */
  /* SHOW MORE reads `quick`: the live games and the follows of the last read (seconds old, and the next tick reads them
     again), so a press waits only for rows it does not hold yet */
  /* CHECK VIA LEAGUE (Louie, 2026-10-14): three tick-box dropdowns under the tabs - continent, country, league, each
     narrowing the next - and the tabs then show the most recent games of the leagues that are left, read for those
     leagues alone (not picked out of the forty everybody's tabs hold). Kept for the visit, as the tab is. */
  const PICK_KEY = 'epinoia_home_fxpick';
  /* pick: the leagues left by the dropdowns (null: all); pickLg: the leagues ticked BY NAME in the League dropdown - a
     grouped league ticked by name is read into the tab's own list like any league, one only picked through its country
     or continent stays in its group's block */
  let pick = null, pickLg = new Set();
  try { const v = JSON.parse(sessionStorage.getItem(PICK_KEY) || 'null'); if (v && v.sel) pick = v.ids && v.ids.length ? new Set(v.ids) : null; if (v && v.sel && pick) pickLg = new Set((v.sel.lg || []).map(String)); } catch (_) { /* private mode */ }
  const pickedHeld = new Map();
  let pickSeq = 0;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  /* the picked leagues' games of one kind: the newest finals, or the next scheduled games (a minute's keep); the filter
     is the one globalgames.js uses, on the inner-embedded season's league. `skip`: the picked leagues shown in their
     group's block instead */
  async function picked(G, kind, now, need, skip) {
    const ids = [...pick].filter(x => UUID.test(x) && !(skip && skip.has(x)));
    if (!ids.length) return [];
    const k = kind + '|' + ids.join(',') + '|' + need;
    const h = pickedHeld.get(k);
    if (h && now - h.at < 60000) return h.rows;
    const only = ids.length === 1 ? '&competitions.seasons.league_id=eq.' + ids[0] : '&competitions.seasons.league_id=in.(' + ids.join(',') + ')';
    const rows = kind === 'res'
      ? await G.request('games?select=' + G.SEL + only + '&status=eq.final&tipoff_at=lt.' + encodeURIComponent(new Date(now).toISOString()) + '&order=tipoff_at.desc,id.desc&limit=' + need, false)
      : await G.request('games?select=' + G.SEL + only + '&status=eq.scheduled&tipoff_at=gte.' + encodeURIComponent(new Date(now - G.STALE_MS).toISOString()) + '&order=tipoff_at.asc,id.asc&limit=' + need, false);
    pickedHeld.set(k, { at: now, rows });
    return rows;
  }
  const inPick = (G, g) => { const l = G.leagueOf(g); return !!(l && pick.has(String(l.id))); };

  /* ======================================================================= THE GROUPS ===
     LEAGUES SHOWN AS ONE GROUP (config.js EPINOIA_LEAGUE_GROUPS; NCAA D2: two leagues of ~23 conferences and up to 140 games
     a night each, Louie 2026-10-14). Listed like any league they would be the whole of Daily fixtures, so on every tab:
       * the tab's own list never reads a grouped league (globalgames.js scoped({ exclude })), so D2 cannot use up the
         forty-row live read, the results or the fixtures - unless the reader ticked that league BY NAME in CHECK VIA
         LEAGUE: then its games are in the list like any league's, and it has no block;
       * after the list, ONE closed block per group with a game in the tab, shown like a COUNTRY: "NCAA D2 · 37 live"
         (a counted read per part, globalgames.js groupCount; the tab's windows are groupWindow's). Its live games count
         in the LIVE tab's badge, so a night when only D2 is live still has a LIVE tab;
       * opened: its parts (Men, Women), each a dropdown with its count; a part opened reads its games LITE and its
         clubs' conferences (groupGames, conferences) and shows its CONFERENCES like leagues, most games first (the
         non-conference games last), each a dropdown with its count; a conference opened reads its own games in full
         (gamesByIds, and the live ones' state) and shows them as the cards everywhere else, without a badge.
     Nothing under the closed block is read until it is opened. What is open stays open through every refresh (per tab:
     each tab is its own list), and a refresh reads again only what is open: on LIVE every tick, on the others a part's
     list once a minute and a conference's cards when its games change.
     THE BLOCK LIVES JUST AFTER THE TAB PANEL, not inside it: the panel is redrawn whenever a score changes, and the block
     must never be taken down with it - a reader's open conference, the focus in it and its sideways scroll stay put. */
  const SEP = '\u001f';
  const pathOf = (...p) => p.map(String).join(SEP);
  const LITE_MS = 60000;
  const GRP = {
    el: null, tab: null, nodes: new Map(),
    open: { live: new Set(), up: new Set(), res: new Set() },
    lite: new Map(), full: new Map(), flight: new Map()
  };

  /* which grouped leagues are a block and which the list reads: every grouped league inside the reader's pick (all of
     them, with no pick) is its group's block unless it was ticked by name; the list reads none but those ticked */
  function scopeOf(grps) {
    const all = [], shown = [];
    (grps || []).forEach(gr => {
      const parts = gr.parts.filter(p => { const id = String(p.id); all.push(id); return (!pick || pick.has(id)) && !pickLg.has(id); });
      if (parts.length) shown.push(Object.assign({}, gr, { parts }));
    });
    const asGroup = new Set();
    shown.forEach(gr => gr.parts.forEach(p => asGroup.add(String(p.id))));
    return { shown, asGroup, exclude: all.filter(id => !pickLg.has(id)) };
  }

  /* each shown group's games on one tab, counted part by part: [{ key, name, parts: [{ part, id, league, n }], n }].
     A count that could not be read is nothing this time; the next tick asks again. */
  function groupCounts(G, shown, tab, now) {
    if (!shown.length || typeof G.groupCount !== 'function') return Promise.resolve([]);
    return Promise.all(shown.map(gr => Promise.all(gr.parts.map(p => G.groupCount([p.id], tab, now).catch(() => 0)))
      .then(ns => {
        const parts = gr.parts.map((p, i) => Object.assign({}, p, { n: +ns[i] || 0 }));
        return Object.assign({}, gr, { parts, n: parts.reduce((s, p) => s + p.n, 0) });
      })));
  }
  const groupTotal = list => (list || []).reduce((s, gr) => s + (gr.n || 0), 0);

  let liveHeld = null;
  async function read(cur, quick) {
    const G0 = window.EpinoiaGlobalGames;
    if (!G0) throw new Error('globalgames.js has not loaded');
    const now = Date.now();
    /* the grouped leagues (none on a page without config.js's groups), and the reads without them */
    const grps = typeof G0.groups === 'function' ? await G0.groups().catch(() => []) : [];
    const sc = scopeOf(grps);
    const pickIds = pick ? [...pick].filter(x => UUID.test(x) && !sc.asGroup.has(x)) : null;
    const G = typeof G0.scoped === 'function' && (sc.exclude.length || (pickIds && pickIds.length))
      ? G0.scoped({ exclude: sc.exclude, only: pickIds }) : G0;
    scopeKey = sc.exclude.join(',') + '|' + (pickIds || []).join(',');
    /* and if a held read from before the groups were known holds one of their games, it is left out here */
    const drop = sc.exclude.length ? new Set(sc.exclude) : null;
    const keep = g => { if (!g) return false; if (!drop) return true; const l = G0.leagueOf(g); return !(l && drop.has(String(l.id))); };
    const [liveAll, fol, gLive] = quick && liveHeld ? liveHeld
      : await Promise.all([G.live().catch(() => []), followed(), groupCounts(G0, sc.shown, 'live', now)]);
    liveHeld = [liveAll, fol, gLive];
    const liveRaw = liveAll.filter(keep);
    const lives = G.pickLive(liveRaw, now, fol).filter(g => !pick || inPick(G, g));
    const liveN = lives.length + groupTotal(gLive);
    const tabPick = G.dailyTab({ chosen, live: liveN, current: cur });
    const tab = tabPick.tab;
    let rows, avail;
    if (pick && tab !== 'live') {
      const all = await picked(G, tab, now, limit[tab] + 1, sc.asGroup);
      rows = all.slice(0, limit[tab]); avail = all.length;
    } else if (tab === 'live') {
      rows = lives.slice(0, limit.live); avail = lives.length;
    } else if (tab === 'res') {
      const held = (await results(G, now, limit.res + 1)).filter(keep);
      const all = G.pickResults(held, N, limit.res + 1, PER_LEAGUE);
      rows = all.slice(0, limit.res); avail = all.length;
    } else {
      const [upsAll, nextsAll] = await Promise.all([upcoming(G, now, limit.up + 1), nextGames(G)]);
      const ups = upsAll.filter(keep), nexts = nextsAll.filter(keep);
      const all = G.pickUpcoming(liveRaw, ups, nexts, now, N, limit.up + 1, fol);
      rows = all.slice(0, limit.up); avail = all.length;
    }
    /* the groups' counts on this tab (LIVE's are the ones just read; SHOW MORE keeps the last read's) */
    const groups = tab === 'live' ? gLive
      : (quick && lastData && lastData.mode === tab && lastData.groups) || await groupCounts(G0, sc.shown, tab, now);
    /* on LIVE every live game's state, not only the shown ones': the dashboard of leagues (below) holds them all */
    const liveIds = (tab === 'live' ? lives : rows).filter(g => g.status === 'live').map(g => g.id);
    const state = liveIds.length ? await G.liveState(liveIds) : {};
    return { rows, all: tab === 'live' ? lives : null, state, now, mode: tab, fell: tabPick.fell, live: liveN, avail, limit: limit[tab], picked: !!pick,
      groups, gAny: groups.some(gr => gr.n > 0) };
  }

  /* ---------------------------------------------------------------- the groups' block ---
     paintGroups(data): the block for the tab on screen, from what is held, changing only what changed - a node made once
     per tab and kept (its open state with it), its count rewritten, its children put in order moving only those out of
     place. loadGroups(tick): reads what is open and missing (or, on a tick, due again), painting as each part lands. */
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const setText = (e, s) => { if (e && e.textContent !== s) e.textContent = s; };
  const countText = (n, tab) => n + (tab === 'live' ? ' live' : tab === 'res' ? (n === 1 ? ' result' : ' results') : ' upcoming');
  /* a box's children, in this order, moving only what is out of place (a moved element loses its scroll) */
  function place(box, els) {
    els.forEach((e, i) => { const at = box.children[i]; if (at !== e) box.insertBefore(e, at || null); });
    while (box.children.length > els.length) box.removeChild(box.children[box.children.length - 1]);
  }
  function waitOf(nd) { return nd.wait || (nd.wait = mk('p', 'fxg-wait', 'loading…')); }
  /* one dropdown of the block: open as the reader left it on this tab; opening one paints what is held and reads the rest */
  function acc(cls, path, tab) {
    const det = mk('details', 'ep-acc hmf-acc fxg-acc ' + cls);
    if (GRP.open[tab].has(path)) det.open = true;
    det.addEventListener('toggle', () => {
      if (GRP.tab !== tab || det.open === GRP.open[tab].has(path)) return;   // a node of another tab's block, or nothing changed
      if (det.open) GRP.open[tab].add(path); else GRP.open[tab].delete(path);
      if (det.open && lastData) { paintGroups(lastData); loadGroups(false).catch(() => {}); }
    });
    return det;
  }
  /* a summary: the name (or the league badge), the count, and optionally a link out */
  function summary(det, title, link) {
    const sum = mk('summary');
    const t = mk('span', 't');
    if (title) t.appendChild(title);
    const n = mk('span', 'hmf-n');
    t.appendChild(n);
    sum.appendChild(t);
    if (link) {
      const go = mk('a', 'hmf-go', 'league →');
      go.href = link;
      go.addEventListener('click', e => e.stopPropagation());       // inside a summary a click would toggle the row instead
      sum.appendChild(go);
    }
    det.appendChild(sum);
    return n;
  }
  function groupNode(G, gr, tab) {
    const det = acc('fxc-lgrp fxg-grp', pathOf(gr.key), tab);
    det.setAttribute('data-grp', gr.key);
    /* the group's name on a league badge (the first part's logo, or its monogram), never translated */
    const b = mk('span', 'fxg-badge');
    badgeInto(G, b, Object.assign({}, gr.parts[0] && gr.parts[0].league, { name: gr.name }));
    const n = summary(det, b, null);
    const body = mk('div', 'fxg-in');
    det.appendChild(body);
    return { det, n, body };
  }
  function partNode(p, path, tab) {
    const det = acc('fxg-part', path, tab);
    det.setAttribute('data-part', String(p.id));
    const nm = mk('span', 'fxg-nm', p.part);
    nm.setAttribute('data-i18n-ctx', 'side');                     // Men / Women, worded as the rail's MEN / WOMEN
    const n = summary(det, nm, p.league && p.league.slug ? base + '?l=' + encodeURIComponent(p.league.slug) : null);
    const body = mk('div', 'fxg-in');
    det.appendChild(body);
    return { det, n, body };
  }
  function confNode(c, path, tab) {
    const det = acc('fxg-conf', path, tab);
    det.setAttribute('data-conf', c.conf || 'none');
    const nm = mk('span', 'fxg-nm', c.conf || 'Non-conference');
    if (c.conf) nm.setAttribute('translate', 'no');                // a conference's name is a name
    const n = summary(det, nm, null);
    const body = mk('div', 'fxg-games');
    det.appendChild(body);
    return { det, n, body };
  }
  const tabOrder = tab => (tab === 'res' ? (a, b) => Date.parse(b.tipoff_at) - Date.parse(a.tipoff_at) : (a, b) => Date.parse(a.tipoff_at) - Date.parse(b.tipoff_at));
  function paintCards(G, nd, p, c, tab) {
    const full = GRP.full.get(pathOf(tab, p.id, c.conf));
    if (!full) { place(nd.body, [waitOf(nd)]); nd.print = null; return; }
    const ids = new Set(c.games.map(g => String(g.id)));
    const rows = full.rows.filter(g => ids.has(String(g.id))).sort((a, b) => tabOrder(tab)(a, b) || (String(a.id) < String(b.id) ? -1 : 1));
    const print = printOf(rows, full.state);
    if (!nd.rail) { nd.rail = mk('div', 'fxc-rail'); nd.rail.setAttribute('role', 'list'); }
    if (nd.print !== print) {
      nd.print = print;
      const left = nd.rail.scrollLeft;
      nd.rail.textContent = '';
      rows.forEach(g => {
        const card = G.card(g, { base, now: Date.now(), state: full.state[g.id], badge: false });
        card.setAttribute('role', 'listitem');
        nd.rail.appendChild(card);
      });
      if (left) nd.rail.scrollLeft = left;
    }
    place(nd.body, [nd.rail]);
  }
  function paintConfs(G, nd, gr, p, tab) {
    const lite = GRP.lite.get(pathOf(tab, p.id));
    if (!lite) { place(nd.body, [waitOf(nd)]); return; }
    place(nd.body, lite.confs.map(c => {
      const path = pathOf(gr.key, p.id, c.conf);
      let cn = GRP.nodes.get(path);
      if (!cn) { cn = confNode(c, path, tab); GRP.nodes.set(path, cn); }
      setText(cn.n, countText(c.n, tab));
      if (cn.det.open) paintCards(G, cn, p, c, tab);
      return cn.det;
    }));
  }
  function paintGroups(data) {
    const G = window.EpinoiaGlobalGames;
    const list = ((data && data.groups) || []).filter(gr => gr.n > 0);
    const parent = host && host.parentNode;
    if (!list.length || !parent || !G) {
      if (GRP.el && GRP.el.parentNode) GRP.el.parentNode.removeChild(GRP.el);
      return;
    }
    const tab = data.mode;
    if (GRP.tab !== tab || !GRP.el) {
      /* another tab: its own block, opened as the reader left it there */
      if (GRP.el && GRP.el.parentNode) GRP.el.parentNode.removeChild(GRP.el);
      GRP.el = mk('div', 'fxg');
      GRP.el.id = 'fxGroups';
      GRP.tab = tab;
      GRP.nodes = new Map();
    }
    if (GRP.el.parentNode !== parent) parent.insertBefore(GRP.el, host.nextSibling || null);
    place(GRP.el, list.map(gr => {
      let nd = GRP.nodes.get(pathOf(gr.key));
      if (!nd) { nd = groupNode(G, gr, tab); GRP.nodes.set(pathOf(gr.key), nd); }
      setText(nd.n, countText(gr.n, tab));
      if (nd.det.open) {
        place(nd.body, gr.parts.filter(p => p.n > 0).map(p => {
          const path = pathOf(gr.key, p.id);
          let pn = GRP.nodes.get(path);
          if (!pn) { pn = partNode(p, path, tab); GRP.nodes.set(path, pn); }
          setText(pn.n, countText(p.n, tab));
          if (pn.det.open) paintConfs(G, pn, gr, p, tab);
          return pn.det;
        }));
      }
      return nd.det;
    }));
  }

  /* one read of a thing at a time: a second asker (a tick while an opening reads) shares the first's */
  function once(k, fn) {
    if (GRP.flight.has(k)) return GRP.flight.get(k);
    const p = Promise.resolve().then(fn);
    const done = () => { if (GRP.flight.get(k) === p) GRP.flight.delete(k); };
    p.then(done, done);
    GRP.flight.set(k, p);
    return p;
  }
  const repaint = tab => { if (lastData && lastData.mode === tab) paintGroups(lastData); };
  async function loadConf(G, tab, p, c, tick) {
    const k = pathOf(tab, p.id, c.conf);
    const ids = c.games.map(g => String(g.id)).sort();
    const held = GRP.full.get(k);
    if (held && held.ids === ids.join(',') && !(tick && tab === 'live')) return;
    await once('f' + k, async () => {
      const rows = await G.gamesByIds(ids);
      const liveIds = rows.filter(g => g.status === 'live').map(g => g.id);
      const state = liveIds.length ? await G.liveState(liveIds) : {};
      GRP.full.set(k, { ids: ids.join(','), rows, state });
    }).catch(() => { /* the next tick asks again */ });
    repaint(tab);
  }
  async function loadPart(G, tab, gr, p, tick) {
    const k = pathOf(tab, p.id);
    const held = GRP.lite.get(k), now = Date.now();
    if (!held || (tick && (tab === 'live' || now - held.at >= LITE_MS))) {
      await once('l' + k, async () => {
        const rows = await G.groupGames([p.id], tab, now);
        const confs = await G.conferences(rows.map(g => g.competition_id));
        GRP.lite.set(k, { at: now, confs: G.byConference(rows, confs) });
      }).catch(() => { /* the next tick asks again */ });
      repaint(tab);
    }
    const lite = GRP.lite.get(k);
    if (!lite) return;
    await Promise.all(lite.confs.filter(c => GRP.open[tab].has(pathOf(gr.key, p.id, c.conf))).map(c => loadConf(G, tab, p, c, tick)));
  }
  async function loadGroups(tick) {
    const G = window.EpinoiaGlobalGames, data = lastData;
    if (!G || !data || !data.groups || !data.groups.length || typeof G.groupGames !== 'function') return;
    const tab = data.mode, open = GRP.open[tab], jobs = [];
    data.groups.forEach(gr => {
      if (!(gr.n > 0) || !open.has(pathOf(gr.key))) return;
      gr.parts.forEach(p => { if (p.n > 0 && open.has(pathOf(gr.key, p.id))) jobs.push(loadPart(G, tab, gr, p, tick)); });
    });
    await Promise.all(jobs);
  }

  /* the clock is in the key too, so a stopped clock that moved (a timeout ended, a new quarter) redraws the card */
  function printOf(rows, state) {
    return rows.map(g => {
      const s = state[g.id] || {};
      return [g.id, g.status, g.tipoff_at, g.home_score, g.away_score, s.period, s.score_home, s.score_away, s.clock_ms, s.running, s.break_ms].join(':');
    }).join('|');
  }
  function keyOf(data) {
    if (isDash(data)) return 'dash>' + dash.open + '>' + dash.shown + '>' + (fellNote ? '!' : '') + '>' + printOf(data.all, data.state);
    return data.mode + '>' + (data.limit === Infinity ? 'all' : data.limit) + '>' + (data.avail > data.rows.length ? '+' : '') +
      (fellNote ? '!' : '') + (data.gAny ? '>g' : '') + '>' + printOf(data.rows, data.state);
  }

  /* ----------------------------------------------------------- the tabs ---
     role=tablist: the chosen tab aria-selected and the only one in the Tab order (the arrows move between them).
     LIVE is hidden while nothing is live (unless it is the tab shown); it slides in when it comes back, and its
     count is read out once each time it changes. */
  function paintTabs(live) {
    if (!seg) return;
    seg.querySelectorAll('button[data-fx]').forEach(b => {
      const on = b.dataset.fx === mode;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && host && b.id) host.setAttribute('aria-labelledby', b.id);
    });
    const lb = seg.querySelector('button[data-fx="live"]');
    if (!lb) return;
    const n = lb.querySelector('.fx-n');
    if (n) n.textContent = String(live);
    const show = live > 0 || mode === 'live';
    if (show && lb.hidden) {
      lb.hidden = false;
      /* the slide-in only when it appears on a page already drawn: the first paint is not news */
      if (liveCount >= 0 && !reduced()) {
        lb.classList.add('is-new');
        setTimeout(() => lb.classList.remove('is-new'), 900);
      }
    } else if (!show && !lb.hidden) lb.hidden = true;
    if (say && liveCount >= 0 && live !== liveCount) say.textContent = live ? live + ' live' : 'No games live';
    liveCount = live;
  }

  /* ------------------------------------------------------------ motion ---
     Web Animations, so nothing is left in a half state by a class: each animation is finished by a timer as well, in
     case the tab stops painting (an element must never be left invisible). Reduced motion: nothing moves. */
  function play(el, frames, opts) {
    if (reduced() || !el || typeof el.animate !== 'function') return null;
    const a = el.animate(frames, Object.assign({ easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' }, opts));
    setTimeout(() => { try { a.finish(); } catch (_) { /* already gone */ } }, (opts.duration || 0) + (opts.delay || 0) + 250);
    return a;
  }
  function growFrom(h0) {
    if (h0 == null) return;
    const h1 = host.offsetHeight;
    if (Math.abs(h1 - h0) < 2) return;
    host.style.overflow = 'hidden';
    const a = play(host, [{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: 380, fill: 'none' });
    const done = () => { host.style.overflow = ''; };
    if (a) a.onfinish = a.oncancel = done; else done();
  }
  function wipeIn(cards, from) {
    cards.slice(from).forEach((c, i) => play(c, [
      { opacity: 0, transform: 'translateY(10px)', clipPath: 'inset(0 0 100% 0)' },
      { opacity: 1, transform: 'none', clipPath: 'inset(0 0 0 0)' }
    ], { duration: 340, delay: Math.min(i, 15) * 50 }));
  }

  /* ------------------------------------------------------------- drawing --- */
  function emptyText(m) {
    return m === 'res' ? 'No results yet. The full list is on the fixtures page.'
      : m === 'live' ? 'Nothing is live just now.'
      : 'No games in the next few days. The full list is on the fixtures page.';
  }

  /* the tab's own list, then the groups' block after it (THE GROUPS: painted on every draw, changed only where it changed) */
  function draw(data, first, opts) {
    drawList(data, first, opts);
    paintGroups(data);
  }

  function drawList(data, first, opts) {
    const G = window.EpinoiaGlobalGames;
    const o = opts || {};
    lastData = data;
    const key = keyOf(data);
    if (key === lastKey && !first && !o.force) return;
    lastKey = key;

    if (!data.rows.length) {
      host.textContent = '';
      if (fellNote) host.appendChild(note());
      /* nothing in the tab's own list but a group's block under it: the block is what there is, not "nothing" */
      if (data.gAny) return;
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = data.picked ? 'No ' + (data.mode === 'res' ? 'results' : data.mode === 'live' ? 'live games' : 'games to come') + ' for the leagues you picked.' : emptyText(data.mode);
      host.appendChild(d);
      if (first) H.fadeIn(d);
      return;
    }

    /* MORE THAN THREE LEAGUES LIVE: the dashboard of leagues, on a phone as on a desktop */
    if (isDash(data)) { drawDash(G, data, first, o || {}); return; }
    /* MORE LIVE GAMES THAN THE RAIL HOLDS: split by league, one dropdown row each, the shape of MY FOLLOWED's rows */
    if (isSplit(data)) { drawSplit(G, data, first, o || {}); return; }

    /* the old rail's scroll position, and what had focus, survive a redraw */
    const old = host.querySelector('.fxc-rail');
    const left = old ? old.scrollLeft : 0;
    const act = typeof document.activeElement !== 'undefined' && document.activeElement && host.contains && host.contains(document.activeElement)
      ? (document.activeElement.getAttribute('data-act') || document.activeElement.getAttribute('href')) : null;
    const rail = document.createElement('div');
    rail.className = 'fxc-rail' + (data.rows.length > N ? ' is-open' : '');
    rail.id = 'fxList';
    rail.setAttribute('role', 'list');
    const cards = data.rows.map(g => {
      const c = G.card(g, { base, now: data.now, state: data.state[g.id] });
      c.setAttribute('role', 'listitem');
      rail.appendChild(c);
      return c;
    });
    host.textContent = '';
    if (fellNote) host.appendChild(note());
    host.appendChild(rail);
    const foot = moreBar(data);
    if (foot) host.appendChild(foot);
    if (left && data.rows.length <= N) rail.scrollLeft = left;
    if (first) H.fadeIn(rail);
    if (o.reveal != null) {
      wipeIn(cards, o.reveal);
      growFrom(o.h0);
      const c = cards[o.reveal];
      if (c && typeof c.focus === 'function') {
        c.focus({ preventScroll: true });
        /* the new cards start where the button was, often the bottom of the screen: bring the first of them into view */
        if (typeof c.scrollIntoView === 'function') c.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
      }
    } else if (o.h0 != null) {
      growFrom(o.h0);
    } else if (act) {
      const back = Array.from(host.querySelectorAll('[data-act],a[href]')).find(e => (e.getAttribute('data-act') || e.getAttribute('href')) === act);
      if (back) back.focus({ preventScroll: true });
    }
  }

  function note() {
    const p = document.createElement('p');
    p.className = 'fx-note';
    p.setAttribute('role', 'status');
    p.textContent = 'Nothing is live just now, so here is what is next.';
    return p;
  }

  /* SHOW MORE / SHOW LESS / ALL FIXTURES under the cards. Nothing at all when the tab's first eight are all there is. */
  function moreBar(data) {
    const G = window.EpinoiaGlobalGames;
    const shown = data.rows.length, F = firstOf(data.mode);
    const step = G.moreStep(shown, data.avail, stepOf(data.mode), capOf(data.mode));
    const open = data.limit > F && shown > F;
    if (!step.more && !open) return null;
    const bar = document.createElement('div');
    bar.className = 'fx-more';
    if (step.more) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ep-btn fx-more-btn';
      b.setAttribute('data-act', 'more');
      b.setAttribute('aria-controls', 'fxList');
      b.setAttribute('aria-expanded', String(open));
      b.textContent = 'Show more';
      b.addEventListener('click', () => showMore(b));
      bar.appendChild(b);
    } else if (data.mode !== 'live') {
      const a = document.createElement('a');
      a.className = 'ep-btn fx-all';
      a.href = base + 'games/';
      a.textContent = 'all fixtures →';
      bar.appendChild(a);
    }
    if (open) {
      const l = document.createElement('button');
      l.type = 'button';
      l.className = 'ep-btn fx-less';
      l.setAttribute('data-act', 'less');
      l.setAttribute('aria-controls', 'fxList');
      l.setAttribute('aria-expanded', 'true');
      l.textContent = 'Show less';
      l.addEventListener('click', showLess);
      bar.appendChild(l);
    }
    return bar;
  }

  async function showMore(btn, tries) {
    /* a press during a background refresh waits for it (then presses the button that refresh drew), never lost */
    if (busy) {
      if ((tries || 0) < 40) setTimeout(() => showMore(host.querySelector('[data-act="more"]') || btn, (tries || 0) + 1), 120);
      return;
    }
    /* the cards on screen are another tab's while a switch is loading: their button is not this tab's */
    if (!lastData || lastData.mode !== mode || !btn || btn.disabled && !tries) return;
    const m = mode, G = window.EpinoiaGlobalGames;
    const shown = lastData.rows.length;
    limit[m] = G.moreStep(shown, lastData.avail, stepOf(m), capOf(m)).next;
    busy = true;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    clearTimeout(timer);
    const h0 = host.offsetHeight;
    try {
      const d = await read(m, true);
      if (mode === m && d.mode === m) { applyTab(d); draw(d, false, { force: true, reveal: Math.min(shown, d.rows.length), h0 }); }
    } catch (_) {
      limit[m] = shown;
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    } finally { busy = false; schedule(); }
  }

  function showLess() {
    if (busy || !lastData) return;
    const m = mode;
    const h0 = host.offsetHeight;
    const F = firstOf(m);
    limit[m] = F;
    const d = Object.assign({}, lastData, { rows: lastData.rows.slice(0, F), limit: F, avail: Math.max(lastData.avail, lastData.rows.length) });
    draw(d, false, { force: true, h0 });
    const more = host.querySelector('[data-act="more"]');
    if (more) more.focus({ preventScroll: true });
    /* the top of the section back in view, if the long list had taken the reader past it */
    const sec = host.closest ? host.closest('section') : null;
    if (sec && sec.getBoundingClientRect().top < 0) sec.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  }

  /* THE LIVE GAMES BY LEAGUE. With more than eight live, one long rail says nothing about where they are, so above
     eight they are split into a row per league, in the order the games arrive (a followed league first), each row a
     dropdown like the ones in MY FOLLOWED (the league's badge, how many are live, a link to the league) open on that
     league's cards, which then need no badge of their own. Above 20 live, the first 20 are shown and SHOW MORE adds
     20 a press (all of them are already read, so it fetches nothing). What a reader shuts stays shut, and each row's sideways scroll stays put, across the redraws of a live night. */
  const shut = new Set();
  function isSplit(data) {
    return data.mode === 'live' && data.rows.length > N;
  }
  function drawSplit(G, data, first, o) {
    const groups = new Map();
    data.rows.forEach(g => {
      const l = G.leagueOf ? G.leagueOf(g) : null;
      const k = l && l.id != null ? String(l.id) : '';
      if (!groups.has(k)) groups.set(k, { key: k, league: l, games: [] });
      groups.get(k).games.push(g);
    });
    const lefts = new Map();
    host.querySelectorAll('.fxc-rail[data-lg]').forEach(r => lefts.set(r.getAttribute('data-lg'), r.scrollLeft));
    const wrap = document.createElement('div');
    wrap.className = 'fxc-groups';
    wrap.id = 'fxList';
    groups.forEach(gr => {
      const det = document.createElement('details');
      det.className = 'ep-acc hmf-acc fxc-lgrp';
      det.setAttribute('data-lg', gr.key);
      if (!shut.has(gr.key)) det.open = true;
      det.addEventListener('toggle', () => { if (det.open) shut.delete(gr.key); else shut.add(gr.key); });
      const sum = document.createElement('summary');
      const t = document.createElement('span');
      t.className = 't';
      if (gr.league && typeof window.epinoiaLeagueBadge === 'function') { t.innerHTML = window.epinoiaLeagueBadge(gr.league, { cls: 'lg' }); G.wireBadges(t); }
      else t.textContent = (gr.league && gr.league.name) || 'League';
      const n = document.createElement('span');
      n.className = 'hmf-n';
      n.textContent = gr.games.length + ' live';
      t.appendChild(n);
      sum.appendChild(t);
      if (gr.league && gr.league.slug) {
        const go = document.createElement('a');
        go.className = 'hmf-go';
        go.textContent = 'league →';
        go.href = base + '?l=' + encodeURIComponent(gr.league.slug);
        go.addEventListener('click', e => e.stopPropagation());       // inside a summary a click would toggle the row instead
        sum.appendChild(go);
      }
      det.appendChild(sum);
      const rail = document.createElement('div');
      rail.className = 'fxc-rail';
      rail.setAttribute('role', 'list');
      rail.setAttribute('data-lg', gr.key);
      gr.games.forEach(g => {
        const c = G.card(g, { base, now: data.now, state: data.state[g.id], badge: false });
        c.setAttribute('role', 'listitem');
        rail.appendChild(c);
      });
      det.appendChild(rail);
      wrap.appendChild(det);
      if (lefts.get(gr.key)) setTimeout(() => { rail.scrollLeft = lefts.get(gr.key); }, 0);
    });
    host.textContent = '';
    if (fellNote) host.appendChild(note());
    host.appendChild(wrap);
    /* above 20 live: SHOW MORE / SHOW LESS under the rows, the new cards revealed the way the rail's are */
    const foot = moreBar(data);
    if (foot) host.appendChild(foot);
    if (first) H.fadeIn(wrap);
    if (o.reveal != null) {
      const cards = Array.from(wrap.querySelectorAll('.fxc'));
      wipeIn(cards, o.reveal);
      growFrom(o.h0);
      const c = cards[o.reveal];
      if (c && typeof c.focus === 'function') c.focus({ preventScroll: true });
    } else if (o.h0 != null) {
      growFrom(o.h0);
    }
  }

  /* ===================================================== THE LIVE DASHBOARD (every screen) ===
     MORE THAN THREE LEAGUES LIVE (2026-10-04; on a phone too from 2026-10-04: one column of cards): the LIVE tab is a dashboard of the leagues, a card each,
     in the order their games arrive (a followed league first), each in the league's own colours: its badge, how many
     are live, and its games as scorebugs (globalgames.js liveLine: crests, names, the score with the side ahead in full,
     the period, its pips and the running clock), the first four and "...and N more". It is the LEAGUES that are counted, not the games: eight cards,
     then SHOW MORE LEAGUES eight at a time, and every live game of a league is behind its card. A press on a card opens
     that league's games, the view growing out of the card; ALL LIVE LEAGUES goes back, the card it came from marked.
     A league whose games have all finished closes by itself. Three leagues or fewer keep the rows above. */
  const DASH_AT = 3, DASH_N = 8, DASH_STEP = 8, DASH_LINES = 4;
  const dash = { open: null, shown: DASH_N };
  function leagueGroups(G, rows) {
    const groups = new Map();
    (rows || []).forEach(g => {
      const l = G.leagueOf ? G.leagueOf(g) : null;
      const k = l && l.id != null ? String(l.id) : '';
      if (!groups.has(k)) groups.set(k, { key: k, league: l, games: [] });
      groups.get(k).games.push(g);
    });
    return [...groups.values()];
  }
  function isDash(data) {
    const G = window.EpinoiaGlobalGames;
    return !!(G && data && data.mode === 'live' && leagueGroups(G, data.all || data.rows).length > DASH_AT);
  }
  const hexOf = v => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? v : null);
  const tint = (n, lg) => { const a = hexOf(lg && lg.colour_a), b = hexOf(lg && lg.colour_b) || a; if (a) n.style.setProperty('--la', a); if (b) n.style.setProperty('--lb', b); };
  function badgeInto(G, n, lg) {
    if (lg && typeof window.epinoiaLeagueBadge === 'function') { n.innerHTML = window.epinoiaLeagueBadge(lg, { cls: 'lg' }); G.wireBadges(n); }
    else n.textContent = (lg && lg.name) || 'League';
  }
  function dashCard(G, data, gr) {
    const item = document.createElement('div');
    item.className = 'fxd-item';
    item.setAttribute('role', 'listitem');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fxd-lg';
    b.setAttribute('data-lg', gr.key);
    tint(b, gr.league);
    const name = (gr.league && gr.league.name) || 'League';
    b.setAttribute('aria-label', name + ': ' + gr.games.length + ' live. Open its games');
    const hd = document.createElement('span'); hd.className = 'fxd-hd';
    const bd = document.createElement('span'); bd.className = 'fxd-badge'; badgeInto(G, bd, gr.league);
    const n = document.createElement('span'); n.className = 'fxd-n';
    n.appendChild(Object.assign(document.createElement('i'), { className: 'dot' }));
    n.appendChild(document.createTextNode(gr.games.length + ' live'));
    hd.append(bd, n);
    const lines = document.createElement('span'); lines.className = 'fxd-lines';
    gr.games.slice(0, DASH_LINES).forEach(g => lines.appendChild(G.liveLine(g, { state: data.state[g.id] })));
    const ft = document.createElement('span'); ft.className = 'fxd-ft';
    if (gr.games.length > DASH_LINES) {
      const more = document.createElement('span'); more.className = 'fxd-more';
      more.textContent = '...and ' + (gr.games.length - DASH_LINES) + ' more';
      ft.appendChild(more);
    }
    ft.appendChild(Object.assign(document.createElement('span'), { className: 'fxd-go', textContent: 'open \u2192' }));
    b.append(hd, lines, ft);
    b.addEventListener('click', () => openLeague(gr.key, b));
    item.appendChild(b);
    return item;
  }
  function dashBoard(G, data, groups) {
    const wrap = document.createElement('div');
    wrap.className = 'fxd';
    wrap.id = 'fxList';
    const grid = document.createElement('div');
    grid.className = 'fxd-grid';
    grid.setAttribute('role', 'list');
    grid.setAttribute('aria-label', groups.length + ' leagues live');
    groups.slice(0, dash.shown).forEach(gr => grid.appendChild(dashCard(G, data, gr)));
    wrap.appendChild(grid);
    if (groups.length > dash.shown || dash.shown > DASH_N) {
      const bar = document.createElement('div');
      bar.className = 'fx-more';
      const btn = (cls, text, act, fn) => {
        const x = document.createElement('button');
        x.type = 'button'; x.className = 'ep-btn ' + cls; x.textContent = text;
        x.setAttribute('data-act', act); x.setAttribute('aria-controls', 'fxList');
        x.addEventListener('click', fn);
        bar.appendChild(x);
      };
      if (groups.length > dash.shown) {
        btn('fx-more-btn', 'Show more leagues', 'more-leagues', () => {
          const from = dash.shown, h0 = host.offsetHeight;
          dash.shown += DASH_STEP;
          draw(lastData, false, { force: true, reveal: from, h0, focusAt: from });
        });
      }
      if (dash.shown > DASH_N) {
        btn('fx-less', 'Show fewer leagues', 'less-leagues', () => {
          const h0 = host.offsetHeight;
          dash.shown = DASH_N;
          draw(lastData, false, { force: true, h0, focus: '[data-act="more-leagues"]' });
        });
      }
      wrap.appendChild(bar);
    }
    return wrap;
  }
  function dashLeague(G, data, gr) {
    const wrap = document.createElement('div');
    wrap.className = 'fxd-one';
    wrap.id = 'fxList';
    tint(wrap, gr.league);
    const bar = document.createElement('div');
    bar.className = 'fxd-bar';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'ep-btn fxd-back';
    back.textContent = '\u2190 All live leagues';
    back.addEventListener('click', backToAll);
    const t = document.createElement('span'); t.className = 'fxd-badge'; badgeInto(G, t, gr.league);
    const n = document.createElement('span'); n.className = 'fxd-n';
    n.appendChild(Object.assign(document.createElement('i'), { className: 'dot' }));
    n.appendChild(document.createTextNode(gr.games.length + ' live'));
    bar.append(back, t, n);
    if (gr.league && gr.league.slug) {
      const go = document.createElement('a');
      go.className = 'hmf-go';
      go.textContent = 'league \u2192';
      go.href = base + '?l=' + encodeURIComponent(gr.league.slug);
      bar.appendChild(go);
    }
    const rail = document.createElement('div');
    rail.className = 'fxc-rail is-open';
    rail.setAttribute('role', 'list');
    gr.games.forEach(g => {
      const c = G.card(g, { base, now: data.now, state: data.state[g.id], badge: false });
      c.setAttribute('role', 'listitem');
      rail.appendChild(c);
    });
    wrap.append(bar, rail);
    return wrap;
  }
  /* the view grows out of the card that was pressed: a clip from the card's rectangle to the whole view */
  function growOut(view, from) {
    if (reduced() || !from || typeof view.animate !== 'function') return;
    const to = view.getBoundingClientRect();
    if (!to.width || !to.height) return;
    let z = 1;
    try { z = parseFloat(window.getComputedStyle(document.body).zoom) || 1; } catch (_) { z = 1; }
    const px = v => Math.max(0, v / z).toFixed(1) + 'px';
    const inset = px(from.top - to.top) + ' ' + px(to.right - from.right) + ' ' + px(to.bottom - from.bottom) + ' ' + px(from.left - to.left);
    play(view, [{ clipPath: 'inset(' + inset + ' round 8px)', opacity: 0.55 }, { clipPath: 'inset(0px 0px 0px 0px round 0px)', opacity: 1 }],
      { duration: 460 });
    wipeIn(Array.from(view.querySelectorAll('.fxc')), 0);
  }
  function openLeague(key, card) {
    if (!lastData) return;
    const from = card && card.getBoundingClientRect ? card.getBoundingClientRect() : null;
    dash.open = key;
    draw(lastData, false, { force: true, anim: 'in', from, h0: host.offsetHeight, focus: '.fxd-back' });
  }
  function backToAll() {
    if (!lastData) return;
    const key = dash.open;
    dash.open = null;
    draw(lastData, false, { force: true, anim: 'out', key, h0: host.offsetHeight });
  }
  function drawDash(G, data, first, o) {
    const groups = leagueGroups(G, data.all || data.rows);
    if (dash.open != null && !groups.some(gr => gr.key === dash.open)) dash.open = null;   // its games have all finished
    host.textContent = '';
    if (fellNote) host.appendChild(note());
    const view = dash.open != null ? dashLeague(G, data, groups.find(gr => gr.key === dash.open)) : dashBoard(G, data, groups);
    host.appendChild(view);
    if (first) H.fadeIn(view);
    if (o.anim === 'in') growOut(view, o.from);
    else if (o.anim === 'out') {
      if (!reduced()) play(view, [{ opacity: 0, transform: 'scale(1.02)' }, { opacity: 1, transform: 'none' }], { duration: 320 });
      const back = Array.from(view.querySelectorAll('.fxd-lg')).find(c => c.getAttribute('data-lg') === o.key);
      if (back) {
        back.classList.add('is-back');
        setTimeout(() => back.classList.remove('is-back'), 1400);
        back.focus({ preventScroll: true });
      }
    } else if (o.reveal != null) {
      const cards = Array.from(view.querySelectorAll('.fxd-item'));
      wipeIn(cards, o.reveal);
      const c = cards[o.focusAt != null ? o.focusAt : o.reveal];
      const b = c && c.querySelector('.fxd-lg');
      if (b) { b.focus({ preventScroll: true }); if (typeof b.scrollIntoView === 'function') b.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); }
    }
    if (o.h0 != null) growFrom(o.h0);
    if (o.focus) { const f = host.querySelector(o.focus); if (f) f.focus({ preventScroll: true }); }
    /* THE VIEW CHANGED UNDER THE READER: a league's games are far shorter than the board of cards, so the page below shortens and the
       reader is left where the strip beneath it landed. Open a league and its games are brought to the top; go back and the board is */
    if (o.anim === 'in' || o.anim === 'out') {
      const target = o.anim === 'in' ? view : host;
      target.style.scrollMarginTop = '84px';
      const go = () => { try { target.scrollIntoView({ block: 'start', behavior: 'auto' }); } catch (_) { /* a browser without it stays put */ } };
      go(); if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
    }
  }

  function anyLive() { return liveCount > 0 || !!(host && host.querySelector && host.querySelector('.fxc.is-live')); }

  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(refresh, delay != null ? delay : (anyLive() ? LIVE_MS : IDLE_MS));
  }

  /* what a read says about the tabs: LIVE emptying under the reader is the one move the page makes by itself */
  function applyTab(d) {
    /* the line goes once something is live again (the LIVE tab is back) or the reader picks a tab */
    if (d.fell) fellNote = true;
    else if (d.live > 0 || d.mode !== 'up') fellNote = false;
    mode = d.mode;
    paintTabs(d.live);
  }

  async function refresh() {
    if (busy) return schedule();
    /* a tab nobody is looking at does not poll; it catches up when it is shown again */
    if (hidden()) return schedule();
    busy = true;
    const cur = mode;
    try {
      const d = await read(cur);
      if (mode === cur) { applyTab(d); draw(d, false); loadGroups(true).catch(() => {}); }
    }
    catch (e) { /* a blip keeps what is on screen; the next tick tries again */ }
    finally { busy = false; schedule(); }
  }

  function listen() {
    if (rt || !window.EpinoiaRT || !window.EPINOIA_CONFIG) return;
    try {
      rt = window.EpinoiaRT.create({ url: window.EPINOIA_CONFIG.supabaseUrl, key: window.EPINOIA_CONFIG.supabaseAnonKey });
    } catch (_) { rt = null; }
    if (!rt) return;
    let soon = null;
    rt.watch('epinoia:live', () => {
      clearTimeout(soon);
      soon = setTimeout(() => schedule(0), 80 + Math.random() * 1200);
    });
  }

  /* the tabs: choosing one reads and draws it at once; the arrows, Home and End move between them (the tab pattern) */
  async function choose(fx) {
    if (fx === mode) return;
    mode = fx;
    chosen = fx;
    fellNote = false;
    try { sessionStorage.setItem(MODE_KEY, fx); } catch (_) { /* private mode */ }
    paintTabs(Math.max(0, liveCount));
    clearTimeout(timer);
    host.setAttribute('aria-busy', 'true');
    /* the old tab's cards stay until the new ones land, dimmed, and their SHOW MORE / LESS do nothing meanwhile */
    host.querySelectorAll('button[data-act]').forEach(b => { b.disabled = true; });
    try {
      const d = await read(fx);
      if (mode === fx) { applyTab(d); lastKey = null; draw(d, true); loadGroups(false).catch(() => {}); }
    }
    catch (_) { /* what is on screen stays; the next tick tries again */ }
    finally { host.removeAttribute('aria-busy'); schedule(); }
  }
  /* the dropdowns themselves are home/leaguepick.js (shared with Games to watch); this keeps the fixtures' side */
  function wirePick() {
    const LP = window.EpinoiaLeaguePick;
    if (!LP || !seg || !host || !host.parentNode) return;
    LP.mount({ id: 'fxPick', key: PICK_KEY, btnAfter: seg, barBefore: host, base: '../',
      onChange: (ids, how) => {
        pick = ids;
        /* the leagues ticked by name (leaguepick.js passes its choice): a grouped one of those is read into the list */
        pickLg = new Set(ids && how && how.sel && Array.isArray(how.sel.lg) ? how.sel.lg.map(String) : []);
        lastKey = null;
        clearTimeout(timer);
        host.setAttribute('aria-busy', 'true');
        /* a tab picked, or another box ticked, while this read runs wins: its answer is dropped */
        const cur = mode, seq = ++pickSeq;
        read(cur).then(d => { if (mode === cur && seq === pickSeq) { applyTab(d); draw(d, true); loadGroups(false).catch(() => {}); } }).catch(() => {}).finally(() => { if (seq === pickSeq) { host.removeAttribute('aria-busy'); schedule(); } });
      } });
  }

  function wireSeg() {
    /* a page without the buttons (or a stand-in document) just has the one view */
    seg = typeof document.getElementById === 'function' ? document.getElementById('fxSeg') : null;
    say = typeof document.getElementById === 'function' ? document.getElementById('fxSay') : null;
    if (!seg) return;
    seg.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('button[data-fx]');
      if (b) choose(b.dataset.fx);
    });
    seg.addEventListener('keydown', e => {
      const tabs = Array.from(seg.querySelectorAll('button[data-fx]')).filter(b => !b.hidden);
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      let j = -1;
      if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = tabs.length - 1;
      if (j < 0) return;
      e.preventDefault();
      tabs[j].focus();
      choose(tabs[j].dataset.fx);
    });
  }

  H.register('fixtures', async function (ctx) {
    host = ctx.host;
    base = ctx.base || '../';
    wireSeg();
    try { wirePick(); } catch (_) { /* the filter is an extra: the fixtures draw without it */ }
    /* THE REFRESH IS SET UP BEFORE THE FIRST READ CAN FAIL. A network blip at app launch
       rethrows (front.js shows its quiet empty state), but the poll, the live nudge and the
       return-to-foreground check still run, and draw() replaces that empty state the first
       time a read succeeds. lastKey stays null until then, so that first draw always paints. */
    listen();
    document.addEventListener('visibilitychange', () => { if (!hidden()) schedule(0); });
    /* a follow saved on this page (a bell, "Who's your favourite?") re-orders the cards at once */
    if (typeof window.addEventListener === 'function') window.addEventListener('epinoia:follows', () => schedule(0));
    busy = true;
    try { const d = await read(mode); applyTab(d); draw(d, true); }
    finally { busy = false; schedule(); }
  });
})();
