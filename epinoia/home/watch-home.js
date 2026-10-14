'use strict';
/* ============================================================================
   HOME — GAMES TO WATCH THIS WEEK, section 'watch', in the Games group under My followed (Louie, 2026-10-14).

   Three cards: the week's biggest games across every league, each the game its league's newsroom chose to watch (newsroom.js
   gameCard), ordered by the score it was chosen with. ONE READ: the newsdesks' index (snapshots/narrative/index.json), which
   carries each league's card in small (tools/build-narratives.mjs watchSummary), not every league's file.

   Each card: the league and when, both clubs (crest, record, place), the season's lean as a bar in the clubs' colours, and a
   short line of why it matters; "Why it matters" opens the rest - the storylines it touches, where it will be decided, the
   players to watch - and the game's preview.

   THE WATCH SCORE, OUT OF 100 (Louie, 2026-10-14): the score the newsroom chose each game with (newsroom.js gameCard) - what
   is at stake (narrative.js slate: how high both clubs sit, how close together, how tight the season's numbers make it)
   times how much its card can say and how well - over 1.5, the most a regular-season game can be at stake, so 100 is a
   top-of-the-table, too-close-to-call game with plenty to say; a rivalry or a series game can pass it and is held at 100.
   The cards are in its order, highest first.

   CHECK VIA LEAGUE (home/leaguepick.js, as Daily fixtures has it): continent, country, league, offering only the leagues
   with a game to watch; with a choice, every one of their games to watch is shown, not three.

   A DROPDOWN ROW (Louie, 2026-10-14): the cards sit in one row on the kit's accordion (.ep-acc, as My followed's rows), open
   or shut as the reader last left it on this device (OPEN_KEY; open until they shut it). Shut, the row still names the
   week's games with their watch scores; choosing leagues opens it.
   ============================================================================ */
(function () {
  const H = window.EpinoiaHome;
  if (!H) return;
  const N = 3, MAX = 12, KEY = 'epinoia_home_watchpick', OPEN_KEY = 'epinoia_home_watch_open';
  const wasOpen = () => { try { return localStorage.getItem(OPEN_KEY) !== '0'; } catch (_) { return true; } };
  const keepOpen = on => { try { localStorage.setItem(OPEN_KEY, on ? '1' : '0'); } catch (_) { /* private mode: open each time */ } };
  const shortName = s => (s && (s.short || s.name)) || '?';
  const DAY = 86400000;
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const hexOf = v => (/^#[0-9a-f]{3,8}$/i.test(String(v || '')) ? v : null);
  const SCALE = 1.5;
  const markOf = w => Math.max(1, Math.min(100, Math.round(100 * (+w.score || +w.stakes || 0) / SCALE)));
  const ordN = n => { const v = Math.round(+n), t = v % 100; return v + (t >= 11 && t <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th')); };

  async function readIndex() {
    const C = window.EPINOIA_CONFIG || {};
    if (!C.supabaseUrl) return null;
    const r = await fetch(C.supabaseUrl + '/storage/v1/object/public/snapshots/narrative/index.json');
    return r.ok ? r.json() : null;
  }

  function crest(side) {
    if (typeof window.epinoiaCrest === 'function') return window.epinoiaCrest({ name: side.name, short_name: side.short, colour: side.colour, logo_path: side.logo }, { cls: 'ep-crest gw-cr' });
    const s = el('span', 'gw-cr gw-cr-txt', (side.short || side.name || '').slice(0, 3));
    if (hexOf(side.colour)) s.style.background = side.colour;
    return s;
  }

  function sideEl(s, base, away) {
    const d = el('div', 'gw-side' + (away ? ' away' : ''));
    if (hexOf(s.colour)) d.style.setProperty('--club', s.colour);
    d.appendChild(crest(s));
    const nm = el('div', 'gw-nm');
    const name = s.slug ? el('a', 'gw-name', s.name || 'A club') : el('b', 'gw-name', s.name || 'A club');
    if (s.slug) name.href = base + 't/?t=' + encodeURIComponent(s.slug);
    name.setAttribute('translate', 'no');
    nm.appendChild(name);
    const meta = [s.rec, s.rank ? ordN(s.rank) : null].filter(Boolean).join(' · ');
    if (meta) nm.appendChild(el('span', 'gw-meta', meta));
    d.appendChild(nm);
    return d;
  }

  function card(w, base, G) {
    const a = el('article', 'gw-card');
    a.dataset.i18nCtx = 'newsdesk';
    const ch = hexOf(w.home.colour) || 'var(--lume)', ca = hexOf(w.away.colour) || 'var(--flare)';
    a.style.setProperty('--ha', ch); a.style.setProperty('--aa', ca);
    /* the league and when */
    const top = el('div', 'gw-top');
    const lg = el('span', 'gw-lg');
    if (w.league && typeof window.epinoiaLeagueBadge === 'function') { lg.innerHTML = window.epinoiaLeagueBadge(w.league, { cls: 'lg' }); if (G && G.wireBadges) G.wireBadges(lg); }
    else lg.textContent = (w.league && w.league.name) || '';
    const at = new Date(w.at);
    const when = el('span', 'gw-when', isNaN(at) ? '' : at.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    const tl = el('div', 'gw-tl');
    tl.append(lg, when);
    top.appendChild(tl);
    a.appendChild(top);
    /* the pills: a rivalry, and an UPSET ALERT when the What wins model gives the underdog a real edge somewhere (narrative.js) */
    const dogName = w.upset ? (w.upset.side === w.home.id ? w.home.name : w.away.name) : '';
    if (w.rival || w.upset) {
      const pills = el('div', 'gw-pills');
      if (w.rival) pills.appendChild(el('span', 'gw-rival', 'Rivalry'));
      if (w.upset) {
        const u = el('span', 'gw-upset', 'Upset alert');
        u.title = dogName + ': the edge in ' + w.upset.label;
        pills.appendChild(u);
      }
      a.appendChild(pills);
    }
    /* the clubs */
    const mid = el('div', 'gw-teams');
    /* the watch score between the clubs, as a ring filled to it */
    const m = markOf(w);
    const sc = el('div', 'gw-score');
    sc.style.setProperty('--m', String(m));
    sc.setAttribute('role', 'img');
    sc.setAttribute('aria-label', 'Watch score ' + m + ' out of 100');
    sc.title = 'Watch score: what is at stake and how much there is to say about it, out of 100';
    const ring = el('span', 'gw-ring');
    ring.append(el('b', null, String(m)), el('small', null, '/100'));
    sc.append(ring, el('span', 'gw-sl', 'watch score'));
    top.appendChild(sc);
    mid.append(sideEl(w.home, base, false), el('span', 'gw-v', 'v'), sideEl(w.away, base, true));
    a.appendChild(mid);
    /* the lean, in the clubs' colours */
    if (w.lean && w.lean.chance != null) {
      const ph = w.lean.favourite === w.home.id ? w.lean.chance : 100 - w.lean.chance;
      const bar = el('div', 'gw-lean');
      bar.setAttribute('role', 'img');
      bar.setAttribute('aria-label', (w.home.name || '') + ' ' + ph + '%, ' + (w.away.name || '') + ' ' + (100 - ph) + '%');
      const l = el('span', 'gw-lh'), r = el('span', 'gw-la');
      l.style.width = ph + '%'; r.style.width = (100 - ph) + '%';
      l.appendChild(el('b', null, ph + '%')); r.appendChild(el('b', null, (100 - ph) + '%'));
      bar.append(l, r);
      a.appendChild(bar);
    }
    /* the short line, and the rest folded under it */
    const short = w.angle || w.line || (w.threads && w.threads[0]) || null;
    if (short) a.appendChild(el('p', 'gw-short', short));
    const more = el('details', 'gw-more');
    const sum = el('summary', null);
    sum.appendChild(el('span', null, 'Why it matters'));
    more.appendChild(sum);
    const body = el('div', 'gw-body');
    if (w.upset) {
      const up = el('p', 'gw-alert');
      const nm = el('b', null, dogName);
      nm.setAttribute('translate', 'no');
      up.append(el('span', 'gw-alert-k', 'Upset alert'), document.createTextNode(' '), nm, document.createTextNode(' '),
        el('span', null, 'have the edge in ' + w.upset.label + ', worth about ' + w.upset.pts + ' points by the numbers.'));
      body.appendChild(up);
    }
    const why = [w.line && w.line !== short ? w.line : null].concat((w.threads || []).filter(t => t !== short)).filter(Boolean);
    if (why.length) { const ul = el('ul', 'gw-why'); why.forEach(t => ul.appendChild(el('li', null, t))); body.appendChild(ul); }
    (w.reasons || []).forEach(r => {
      const d = el('div', 'gw-reason');
      d.append(el('b', null, r.title), el('p', null, r.text));
      body.appendChild(d);
    });
    if ((w.players || []).length) {
      const p = el('div', 'gw-players');
      p.appendChild(el('b', null, 'Ones to watch'));
      w.players.forEach(x => {
        const row = el('div', 'gw-pl');
        const n = x.slug ? el('a', null, x.name) : el('span', null, x.name);
        if (x.slug) n.href = base + 'p/?p=' + encodeURIComponent(x.slug);
        n.setAttribute('translate', 'no');
        row.appendChild(n);
        if (x.line) row.appendChild(el('span', 'gw-pline', x.line));
        p.appendChild(row);
      });
      body.appendChild(p);
    }
    const how = el('p', 'gw-how');
    how.append(el('b', null, m + '/100'), document.createTextNode(' '),
      el('span', null, 'How much is at stake (how high both clubs sit, how close together and how tight the numbers make it), weighed by how much there is to say about it.'));
    body.appendChild(how);
    const go = el('a', 'ep-btn mini gw-go', 'The game’s preview →');
    go.href = base + 'game/?g=' + encodeURIComponent(w.game);
    body.appendChild(go);
    more.appendChild(body);
    a.appendChild(more);
    return a;
  }

  H.register('watch', async function (ctx) {
    const sec = document.getElementById('watch');
    const G = window.EpinoiaGlobalGames;
    const [idx, leagues] = await Promise.all([readIndex(), G ? G.leagues().catch(() => []) : []]);
    const byId = new Map((leagues || []).map(l => [String(l.id), l]));
    const now = Date.now();
    /* the leagues a reader may see, each with its game to watch in the next seven days (two hours' grace once it tips) */
    const all = Object.keys((idx && idx.leagues) || {}).map(id => {
      const w = idx.leagues[id] && idx.leagues[id].watch;
      const t = w ? Date.parse(w.at) : NaN;
      if (!w || !byId.has(String(id)) || !(t > now - 2 * 3600000 && t < now + 7 * DAY)) return null;
      return Object.assign({ league: byId.get(String(id)) }, w);
    }).filter(Boolean).sort((a, b) => (+b.score || +b.stakes || 0) - (+a.score || +a.stakes || 0));
    if (!all.length) { if (sec) sec.hidden = true; return; }

    const host = ctx.host;
    const grid = el('div', 'gw-grid');
    const note = el('p', 'gw-note');
    /* the row: shut, it names the games and their watch scores; open, the cards */
    const acc = el('details', 'ep-acc hmf-acc gw-acc');
    const sum = el('summary');
    const lead = el('span', 'gw-sum-k');
    const chips = el('span', 't gw-chips');
    const count = el('span', 'hmf-n gw-count');
    sum.append(lead, chips, count);
    const inner = el('div', 'gw-in');
    inner.append(grid, note);
    acc.append(sum, inner);
    acc.open = wasOpen();
    let pick = null, quiet = false;
    function paintRow(shown) {
      lead.textContent = acc.open ? 'The week\u2019s biggest games, by watch score' : 'This week';
      chips.textContent = '';
      if (!acc.open) shown.forEach(w => {
        const c = el('span', 'gw-chip');
        c.append(el('b', 'gw-chip-m', String(markOf(w))));
        const nm = el('span', 'gw-chip-t', shortName(w.home) + ' v ' + shortName(w.away));
        nm.setAttribute('translate', 'no');
        c.appendChild(nm);
        chips.appendChild(c);
      });
      count.textContent = shown.length === 1 ? '1 game' : shown.length + ' games';
    }
    let lastShown = [];
    function draw() {
      const list = pick ? all.filter(w => pick.has(String(w.league.id))) : all;
      const shown = list.slice(0, pick ? MAX : N);
      lastShown = shown;
      grid.textContent = '';
      note.textContent = '';
      paintRow(shown);
      if (!shown.length) { grid.appendChild(el('div', 'empty', 'No games to watch this week in the leagues you picked.')); return; }
      shown.forEach(w => grid.appendChild(card(w, ctx.base || '../', G)));
      if (pick && list.length > shown.length) note.textContent = shown.length + ' / ' + list.length;
    }
    acc.addEventListener('toggle', () => {
      paintRow(lastShown);
      if (quiet) { quiet = false; return; }
      keepOpen(acc.open);
      try { if (window.EpinoiaTrack && window.EpinoiaTrack.action) window.EpinoiaTrack.action(acc.open ? 'watch-open' : 'watch-shut'); } catch (_) { /* a count is never in the way */ }
    });
    host.textContent = '';
    host.appendChild(acc);
    /* the dropdowns, offering only the leagues with a game to watch */
    const LP = window.EpinoiaLeaguePick;
    const h2 = sec && sec.querySelector('.sec-h h2');
    if (sec) sec.querySelectorAll('.fx-pickbtn, #gwPick').forEach(n => n.remove());
    if (LP && h2) {
      const ctl = LP.mount({ id: 'gwPick', key: KEY, btnAfter: h2, barBefore: host, base: ctx.base || '../',
        leagues: () => Promise.resolve([...new Map(all.map(w => [String(w.league.id), w.league])).values()]),
        onChange: ids => { pick = ids; if (!acc.open) { quiet = true; acc.open = true; } draw(); } });
      if (ctl) pick = ctl.ids();
    }
    draw();
    if (sec) sec.hidden = false;
    ctx.fadeIn(grid);
  });
})();
