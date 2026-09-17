'use strict';
/* ============================================================================
   THE VIDEO HUB — one league's read broadcasts, in one picker.

   The game page already turns a play-by-play into footage: epinoia/game/video.js
   is the tab with the player, the filters, the play list, the minutes, the fives
   and the runs. It works because the clock reader (the worker behind video_jobs)
   has watched the broadcast and written down where the game clock stood at each
   second of it, so any (period, clock) in the log has a second in the video.

   The trouble is that nothing on the platform SAYS which games have been read.
   A reader had to open a fixture, find the tab and discover whether it was
   there. This page is the answer: every read game in the league, filtered by
   club and competition, chosen from a dropdown, with the same tab underneath.

   THREE THINGS THIS PAGE DOES THAT THE GAME PAGE DOES NOT:

   1. IT JUDGES THE READING BEFORE IT OFFERS IT (see judge below). "Processed"
      means a job finished, not that the footage can be used. Of the eleven read
      games at the time of writing, two carry a single stray reading that would
      pin the entire game onto one instant of video — which is exactly what a
      reader reported: a game whose first play jumped to the moment the score
      was 7-9 with 7:52 left. Those are not listed. Four more were read only in
      part (one lost its first quarter, one its second, one its overtime, and
      one had nothing read but its fourth), and those ARE listed, with the
      missing periods said out loud rather than discovered by pressing a play
      and landing somewhere else.

   2. IT FETCHES ONE GAME AT A TIME. The listing carries the clock tracks, which
      are hundreds of kilobytes, but no event log; a game's log (several hundred
      rows) is read only when that game is chosen.

   3. IT RESETS THE TAB BETWEEN GAMES. EpinoiaVideoTab keeps its filters, its
      index and its chosen play at module level, deliberately, so that the game
      page's redraws do not throw the reader back to the top. Two games through
      one module means reset() before every render, and never two mounted.

   UMD like data.js and scouting.js: the browser boots it, node requires the
   pure parts (the listing query, the judgement, its wording) for
   supabase/tests/videohub-page.test.mjs.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.EpinoiaVideoHub = api;
    if (root.document) api.boot();
  }
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* ------------------------------------------------------------ the listing ---
   WHAT "READ" MEANS, AS A QUERY.

   A game qualifies when its PRIMARY recording carries a clock track with at
   least one sample and its reading job finished. Both halves matter: a job row
   without a track is a job that ran and found nothing, and a track without a
   finished job is a reading still in flight.

   !inner throughout, so a game with no such recording is not returned at all
   rather than returned with an empty array to filter out here. The video row's
   anchor columns come with it because epinoia/video.js needs them to place
   anything: the track says where the clock stood in the footage, and the anchor
   says where the footage stands in the day. */
const VIDEO_COLS = 'url,provider,video_ref,label,stream_started_at,tip_at,tip_wall,' +
                   'tip_offset_ms,trim_ms,is_live,clock_track';
function listingPath(slug) {
  return 'games?select=id,tipoff_at,status,period,home_score,away_score,' +
    'home:home_team_id(id,slug,name,short_name,colour,colour_2),' +
    'away:away_team_id(id,slug,name,short_name,colour,colour_2),' +
    'competitions!inner(id,name,seasons!inner(name,leagues!inner(id,slug,name))),' +
    'game_videos!inner(' + VIDEO_COLS + '),video_jobs!inner(status)' +
    '&competitions.seasons.leagues.slug=eq.' + encodeURIComponent(slug) +
    '&game_videos.is_primary=eq.true' +
    '&game_videos.clock_track->samples->0=not.is.null' +
    '&video_jobs.status=eq.done&order=tipoff_at.desc';
}

/* -------------------------------------------------------- the judgement ---
   WHICH PERIODS THIS READING CAN ACTUALLY PLACE A PLAY IN.

   The worker is beginning to write a coverage summary into the track, but every
   row read before that has none, so the hub works it out from the readings
   themselves. It asks the same questions epinoia/video.js asks when it places a
   play, and no others — a second opinion here would only be a second way to be
   wrong:

     * saneTrack first. That is the reader's own confidence floor (0.3, where the
       scores split cleanly between real readings and guesses) plus the window a
       reading must fall in to belong to this game at all. What survives is what
       the game page would use.

     * a CLOCK track places a play inside a RUN — a stretch where the clock fell
       at the speed of time — and positionFromTrack refuses a period with no run
       in it rather than projecting from a stray reading. So a period is read
       when it carries a run, and not otherwise.

     * a SCORE track has no runs: its readings ARE the baskets, and a play is
       placed between the two either side of it. One reading is therefore not a
       map of a game, it is a single pin every play in the period would be put
       on. Three is the floor: two readings and everything between them is a
       straight line drawn through the whole period.

   A game with no readable period at all is not listed. A game with some is
   listed and says which, because half a game of footage is worth having and a
   reader who is told it is half a game loses nothing.

   `lastPeriod` is the game's own last period (games.period), so an overtime
   that was never read is reported as missing rather than passing unnoticed. */
const MIN_SCORE_READS = 3;

function judge(video, lastPeriod, videoLib) {
  const V = videoLib || root.EpinoiaVideo;
  const out = { usable: false, mode: '', read: [], missing: [], short: '', note: '' };
  const raw = video && video.clock_track;
  if (!raw || !Array.isArray(raw.samples) || !raw.samples.length) {
    out.note = 'This broadcast has not been read.';
    return out;
  }
  out.mode = String(raw.mode || '');
  const clocked = /clock/.test(out.mode);
  const track = (V && typeof V.saneTrack === 'function') ? V.saneTrack(raw, video) : raw;
  const samples = (track && Array.isArray(track.samples)) ? track.samples : [];

  const read = [];
  if (clocked) {
    const runs = (V && typeof V.runsFromTrack === 'function') ? V.runsFromTrack(track) : [];
    runs.forEach(r => { if (r && r.period != null && read.indexOf(+r.period) === -1) read.push(+r.period); });
  } else {
    const n = {};
    samples.forEach(s => { if (s && s.period != null) n[s.period] = (n[s.period] || 0) + 1; });
    Object.keys(n).forEach(p => { if (n[p] >= MIN_SCORE_READS) read.push(+p); });
  }
  read.sort((a, b) => a - b);
  out.read = read;

  if (!read.length) {
    out.note = clocked
      ? 'The clock was never read running in this broadcast, so no play can be placed in it.'
      : 'The scoreboard was read too few times in this broadcast to place a play in it.';
    return out;
  }
  out.usable = true;

  const last = Math.max(4, +lastPeriod > 0 ? +lastPeriod : 0, read[read.length - 1]);
  for (let p = 1; p <= last; p++) if (read.indexOf(p) === -1) out.missing.push(p);
  if (!out.missing.length) return out;
  out.short = shortCoverage(read, out.missing, last);
  out.note = coverageNote(read, out.missing, last);
  return out;
}

/* ---- saying it in English ---- */
const ORD = ['', 'first', 'second', 'third', 'fourth'];
const perShort = p => (p <= 4 ? 'Q' + p : 'OT' + (p - 4));
function joinWords(w) {
  if (w.length <= 1) return w[0] || '';
  return w.slice(0, -1).join(', ') + ' and ' + w[w.length - 1];
}
/* "the second quarter", "the first and second quarters", "the first overtime" */
function periodWords(ps) {
  const qs = ps.filter(p => p <= 4), ots = ps.filter(p => p > 4);
  const bits = [];
  if (qs.length) bits.push('the ' + joinWords(qs.map(p => ORD[p])) + (qs.length > 1 ? ' quarters' : ' quarter'));
  if (ots.length) bits.push('the ' + joinWords(ots.map(p => ORD[p - 4])) + (ots.length > 1 ? ' overtimes' : ' overtime'));
  return joinWords(bits);
}
const isHalf = (read, a, b) => read.length === 2 && read[0] === a && read[1] === b;
/* the label in the dropdown: short enough to sit after a fixture at 375px */
function shortCoverage(read, missing, last) {
  if (!missing.length) return '';
  if (isHalf(read, 1, 2)) return 'first half only';
  if (isHalf(read, 3, 4) && last === 4) return 'second half only';
  if (read.length === 1) return perShort(read[0]) + ' only';
  if (missing.length === 1) return 'no ' + perShort(missing[0]);
  if (missing.length <= read.length) return 'no ' + missing.map(perShort).join('/');
  return read.map(perShort).join('/') + ' only';
}
/* the sentence under the picker: WHAT the reading covered, and nothing more.
   What that means for the rest is placingNote, which needs the log. */
function coverageNote(read, missing, last) {
  if (!missing.length) return '';
  if (isHalf(read, 1, 2)) return 'Only the first half of this broadcast was read.';
  if (isHalf(read, 3, 4) && last === 4) return 'Only the second half of this broadcast was read.';
  if (missing.length <= read.length) {
    return periodWords(missing).replace(/^the/, 'The') +
      (missing.length > 1 ? ' were' : ' was') + ' not read in this broadcast.';
  }
  return 'Only ' + periodWords(read) + ' of this broadcast ' +
    (read.length > 1 ? 'were' : 'was') + ' read.';
}

/* WHAT THAT MEANS FOR THE PLAYS THE READING DID NOT COVER — which depends on
   the LOG rather than on the reading, so it can only be said once the log is in
   hand.

   epinoia/video.js does not simply drop them. It places such a play from the
   log's own time of day against the tip-off anchor: near the moment rather than
   on it, and marked with a tilde in the list. That is the honest reason to list
   a half-read game at all, and the reader has to be told which half is which,
   or the tilde is the only warning they get.

   A log imported in bulk has no time of day to place them by — every row was
   written in one transaction, so created_at is when the file was loaded — and
   index() leaves those plays out rather than piling them all onto that instant.
   The test is index()'s own, and the tab prints its own notice about it too. */
function placingNote(events, videoLib) {
  const V = videoLib || root.EpinoiaVideo;
  const evs = Array.isArray(events) ? events : [];
  const imported = evs.length >= 20 && !!V && typeof V.logIsTimed === 'function' &&
                   !V.logIsTimed(evs) && !evs.some(e => e && e.wall != null);
  return imported
    ? 'Plays there are not in the list at all: this play-by-play was imported in bulk, ' +
      'so it carries no time of day to place them by either.'
    : 'Plays there are placed from the scorer’s own timing rather than from the footage, ' +
      'so they land near the moment rather than on it — the list marks those with a tilde.';
}

/* --------------------------------------------------------------- the row ---
   One listing row into what the picker and the tab need. Kept pure so the test
   can check the labels without a DOM. */
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayText(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) return '';
  return d.getDate() + ' ' + MONTH[d.getMonth()] +
    (d.getFullYear() === new Date().getFullYear() ? '' : ' ' + d.getFullYear());
}
function gameLabel(row) {
  const home = (row.home && (row.home.name || row.home.short_name)) || 'Home';
  const away = (row.away && (row.away.name || row.away.short_name)) || 'Away';
  const day = dayText(row.tipoff_at);
  const score = (row.home_score != null && row.away_score != null)
    ? '  ' + row.home_score + '-' + row.away_score : '';
  const bad = row.judged && row.judged.short ? '  · ' + row.judged.short : '';
  return (day ? day + '  ·  ' : '') + home + ' v ' + away + score + bad;
}

/* =============================================================== the page === */
function boot() {
  const CFG = root.EPINOIA_CONFIG;
  const E = root.EpinoiaEngine, V = root.EpinoiaVideo, TAB = root.EpinoiaVideoTab;
  const doc = root.document;
  const $ = s => doc.querySelector(s);
  const qp = new URLSearchParams(root.location.search);
  const slug = qp.get('l') || '';

  let league = null, rows = [], chosen = '', openToken = 0, runsLocked = false;

  function msg(html) {
    const host = $('#vidHost');
    if (host) host.innerHTML = '<div class="msg">' + html + '</div>';
  }
  function cover(text, warn) {
    const c = $('#cover');
    if (!c) return;
    c.textContent = text || '';
    c.classList.toggle('warn', !!warn);
  }
  function pickersOff() { const p = $('#picks'); if (p) p.classList.add('hide'); }

  /* THE BUSIEST READ ON THE PLATFORM'S PATTERN, copied from epinoia/game/game.js
     rather than imported: a 429 or a pooler 503 is a "not now" and is asked
     again; anything else is a real answer. A members-only league's rows are
     refused to an anonymous read, so a member's request carries their token —
     and a token the server has stopped accepting is retried once without it,
     because a stale session is not a reason to show nothing. */
  const API_RETRY = new Set([429, 500, 502, 503, 504]);
  async function api(p, attempt = 0, anon = false) {
    const headers = { apikey: CFG.supabaseAnonKey, Accept: 'application/json' };
    const A = root.EpinoiaAccess;
    if (!anon && A && typeof A.authHeaders === 'function') {
      try { Object.assign(headers, A.authHeaders(league && league.id) || {}); } catch (_) { /* anonymous */ }
    }
    let r;
    try {
      r = await fetch(CFG.supabaseUrl + '/rest/v1/' + p, { cache: 'no-store', headers });
    } catch (netErr) {
      if (attempt >= 3) throw netErr;
      await new Promise(res => setTimeout(res, 400 * Math.pow(2, attempt)));
      return api(p, attempt + 1, anon);
    }
    if (r.ok) return r.json();
    if (r.status === 401 && headers.Authorization && !anon) return api(p, attempt, true);
    if (API_RETRY.has(r.status) && attempt < 3) {
      const ra = r.headers.get('retry-after');
      let hold = 400 * Math.pow(2, attempt);
      if (ra && /^\d+$/.test(ra.trim())) hold = Math.min(10000, +ra * 1000);
      await new Promise(res => setTimeout(res, hold));
      return api(p, attempt + 1, anon);
    }
    throw new Error(r.status + ' on ' + p.split('?')[0]);
  }

  /* ------------------------------------------------------------- the log --- */
  /* An event row is stored normalised and the replay wants it flat, payload
     merged back in. created_at rides along untouched: the replay ignores it,
     but it is the ONLY axis a recording shares with the log. */
  function rowToEvent(r) {
    const e = Object.assign({ t: r.t, id: r.seq, period: r.period, clock: r.clock }, r.payload || {});
    if (r.team != null) e.team = r.team;
    if (r.pid != null) e.pid = r.pid;
    if (r.created_at) { e.created_at = r.created_at; e.seq = r.seq; }
    return e;
  }
  async function fetchLog(id) {
    let events = [], from = 0;
    for (;;) {
      const page = await api('game_events?game_id=eq.' + encodeURIComponent(id) +
        '&select=seq,t,team,pid,period,clock,payload,created_at&order=seq&offset=' + from + '&limit=1000');
      events = events.concat(page);
      if (page.length < 1000) break;
      from += 1000;
    }
    return events;
  }

  /* The scorer lower-cased everything as a style and the ingest wrote the
     snapshots that way, so a name is set back to the case a name is written in. */
  const properName = s => String(s || '').trim().toLowerCase()
    .replace(/(^|[\s\-'])([a-z])/g, (m, p, c) => p + c.toUpperCase())
    .replace(/\bMc([a-z])/g, (m, c) => 'Mc' + c.toUpperCase())
    .replace(/\bMac([a-z]{3,})/g, (m, r) => 'Mac' + r[0].toUpperCase() + r.slice(1));

  /* The game, in the shape engine.js replays and the video tab reads — the same
     object epinoia/game/game.js builds in loadStored, minus everything only the
     box score needs. */
  async function buildGame(row) {
    const gs = await api('games?id=eq.' + encodeURIComponent(row.id) +
      '&select=id,status,period,roster_snapshot,starters,tip_winner,arrow_init&limit=1');
    if (!gs.length) throw new Error('that game is no longer readable');
    const g = gs[0];
    const events = await fetchLog(row.id);
    const snap = g.roster_snapshot;
    const club = i => (i === 0 ? row.home : row.away) || {};
    const colour = i => (/^#[0-9a-f]{6}$/i.test(String(club(i).colour || '')) ? club(i).colour : null);
    const teams = (snap && snap.teams) ? snap.teams.map((t, i) => Object.assign({}, t, {
      name: club(i).name || properName(t.name),
      color: colour(i) || t.color,
      players: (t.players || []).map(p => Object.assign({}, p, { name: properName(p.name) }))
    })) : [
      { name: club(0).name || 'home', color: colour(0) || '#93f2bf', players: [] },
      { name: club(1).name || 'away', color: colour(1) || '#8ff5ff', players: [] }
    ];
    const starters = (Array.isArray(g.starters) && g.starters.length === 2) ? g.starters : [[], []];
    const comp = row.competitions || {};
    const season = comp.seasons || {};
    const lg = season.leagues || {};
    return {
      teams, starters,
      events: events.map(rowToEvent),
      period: g.period || 1, clockMs: 0,
      tipWinner: g.tip_winner, arrowInit: g.arrow_init,
      phase: g.status === 'final' ? 'final' : 'game',
      status: g.status,
      competition: [lg.name, comp.name].filter(Boolean).join(' · ') || 'Friendly',
      leagueSlug: lg.slug || null,
      leagueId: lg.id || null,
      video: row.game_videos && row.game_videos[0]
    };
  }

  /* ------------------------------------------------------------ the picks --- */
  function fill(sel, opts, value) {
    if (!sel) return;
    sel.innerHTML = '';
    opts.forEach(o => {
      const el = doc.createElement('option');
      el.value = o.v;
      el.textContent = o.t;
      sel.appendChild(el);
    });
    sel.value = opts.some(o => o.v === value) ? value : (opts[0] ? opts[0].v : '');
  }
  const compOf = r => (r.competitions && r.competitions.id) || '';
  const clubsOf = r => [r.home, r.away].filter(Boolean).map(t => t.id);

  function visible() {
    const comp = $('#compPick').value, club = $('#teamPick').value;
    return rows.filter(r => (!comp || compOf(r) === comp) &&
                            (!club || clubsOf(r).indexOf(club) !== -1));
  }

  function drawFilters() {
    const comps = [];
    rows.forEach(r => {
      const c = r.competitions;
      if (c && c.id && !comps.some(x => x.v === c.id)) comps.push({ v: c.id, t: c.name || 'Competition' });
    });
    const clubs = [];
    rows.forEach(r => [r.home, r.away].forEach(t => {
      if (t && t.id && !clubs.some(x => x.v === t.id)) clubs.push({ v: t.id, t: t.name || t.short_name || 'Club' });
    }));
    clubs.sort((a, b) => a.t.localeCompare(b.t));
    fill($('#compPick'), [{ v: '', t: 'All competitions' }].concat(comps), '');
    fill($('#teamPick'), [{ v: '', t: 'All clubs' }].concat(clubs), '');
    /* ONE COMPETITION IS NOT A CHOICE. The filter stays in the document, so the
       page has one shape, but a picker with a single entry beside "all" is a
       control that cannot do anything. */
    $('#compWrap').classList.toggle('hide', comps.length < 2);
  }

  function drawGames(keep) {
    const list = visible();
    const opts = list.map(r => ({ v: r.id, t: gameLabel(r) }));
    fill($('#gamePick'), opts.length ? opts : [{ v: '', t: 'No read game matches' }], keep);
    $('#gamePick').disabled = !opts.length;
    const want = $('#gamePick').value;
    if (!opts.length) {
      chosen = '';
      teardown();
      cover('');
      msg('No read game matches those filters. <b>Clear them</b> to see the rest.');
      return;
    }
    if (want !== chosen) openGame(want);
  }

  /* THE TAB KEEPS MODULE-LEVEL STATE, so it is reset before every render and
     never mounted twice. Leaving the previous game's index in place is how a
     play list ends up describing one game over another game's footage. */
  function teardown() {
    if (TAB && typeof TAB.reset === 'function') TAB.reset();
    const host = $('#vidHost');
    if (host) host.innerHTML = '';
  }

  async function openGame(id) {
    const row = rows.find(r => r.id === id);
    if (!row) return;
    chosen = id;
    const token = ++openToken;
    teardown();
    msg('Loading the game…');
    const j = row.judged;
    cover(j && j.note ? j.note : '', !!(j && j.note));
    /* the chosen game rides in the address, so a link to this page is a link to
       this game — replaceState, never a history entry per choice */
    try {
      const q = new URLSearchParams(root.location.search);
      q.set('l', slug); q.set('g', id);
      root.history.replaceState(root.history.state, '', root.location.pathname + '?' + q.toString());
    } catch (_) { /* a browser that refuses is not a reason to fail the page */ }

    let S;
    try { S = await buildGame(row); } catch (e) {
      if (token !== openToken) return;
      msg('That game could not be loaded: ' + ((e && e.message) || 'network error'));
      return;
    }
    if (token !== openToken) return;            // the reader moved on while this loaded
    /* now the log is in hand, the note can say what a missing period MEANS */
    if (j && j.note) cover(j.note + ' ' + placingNote(S.events, V), true);
    try {
      const d = E.deriveGame(S);
      teardown();
      TAB.render({
        host: '#vidHost', video: S.video, events: S.events, S: S, d: d,
        game: { id: row.id, home: (row.home || {}).name, away: (row.away || {}).name,
                tipoff_at: row.tipoff_at },
        canEdit: false, runsLocked: runsLocked
      });
    } catch (e) {
      msg('That game could not be replayed: ' + ((e && e.message) || 'error'));
    }
  }

  /* ------------------------------------------------------------- the load --- */
  async function start() {
    if (!CFG || !E || !V || !TAB) { pickersOff(); msg('This page could not start.'); return; }
    if (!slug) {
      pickersOff();
      msg('The video hub belongs to a league. <b>Pick one</b> from the rail to see its read games.');
      return;
    }
    let lgs;
    try { lgs = await api('leagues?slug=eq.' + encodeURIComponent(slug) + '&select=id,slug,name&limit=1'); }
    catch (e) { pickersOff(); msg('The league could not be loaded: ' + ((e && e.message) || 'network error')); return; }
    if (!lgs.length) { pickersOff(); msg('There is no league at that address.'); return; }
    league = lgs[0];
    root.__CS_LEAGUE_SLUG = league.slug;
    const ctx = $('#ctx'); if (ctx) ctx.textContent = league.name || league.slug;
    doc.title = 'Video hub · ' + (league.name || 'Epinoia');
    const fx = $('#fxLink'); if (fx) fx.href = '../fixtures/?l=' + encodeURIComponent(league.slug);

    /* MEMBERSHIPS (docs/memberships.md). Asked BEFORE the listing, because a
       members-only league's rows are refused to an anonymous read and the
       request has to carry the member's token. A viewer who may not see the
       league gets the card in place of the hub; the runs are game flow's
       analysis, which is the members' where the analytics are locked. */
    const A = root.EpinoiaAccess;
    if (A && typeof A.load === 'function') {
      try { await A.load({ leagueId: league.id, leagueSlug: league.slug }); } catch (_) { /* fail open */ }
      const st = (typeof A.get === 'function' && A.get(league.id)) || {};
      if (st.known && typeof A.canView === 'function' && !A.canView(league.id) &&
          typeof A.paywallHTML === 'function') {
        pickersOff();
        cover('');
        $('#vidHost').innerHTML = '';
        const wall = $('#accessWall');
        wall.innerHTML = A.paywallHTML({ league: league });
        wall.classList.remove('hide');
        return;
      }
      runsLocked = typeof A.analyticsOk === 'function' && !A.analyticsOk(league.id);
    }

    let list;
    try { list = await api(listingPath(slug)); } catch (e) {
      pickersOff();
      msg('The read games could not be loaded: ' + ((e && e.message) || 'network error'));
      return;
    }
    /* the judgement decides what is offered at all */
    const judged = list.map(r => Object.assign({}, r, {
      judged: judge(r.game_videos && r.game_videos[0], r.period, V)
    }));
    rows = judged.filter(r => r.judged.usable);
    const dropped = judged.length - rows.length;

    if (!rows.length) {
      pickersOff();
      cover('');
      msg(dropped
        ? 'This league has <b>' + dropped + ' read ' + (dropped === 1 ? 'broadcast' : 'broadcasts') +
          '</b>, but the reading found no stretch of any of them the clock could be trusted in — ' +
          'so there is nothing here that would take you to the right moment. ' +
          'They will appear as they are read again.'
        : 'No game in this league has had its broadcast read yet.');
      return;
    }

    drawFilters();
    $('#compPick').addEventListener('change', () => drawGames($('#gamePick').value));
    $('#teamPick').addEventListener('change', () => drawGames($('#gamePick').value));
    $('#gamePick').addEventListener('change', () => openGame($('#gamePick').value));
    const wanted = qp.get('g');
    drawGames(rows.some(r => r.id === wanted) ? wanted : rows[0].id);

    if (dropped) {
      const foot = $('#foot');
      if (foot) foot.textContent = dropped + ' further ' + (dropped === 1 ? 'broadcast was' : 'broadcasts were') +
        ' read too poorly to place a play, and ' + (dropped === 1 ? 'is' : 'are') + ' not listed.';
    }
  }

  /* Nothing below start() is allowed to become an unhandled rejection: the page
     is a picker and a player, and a reader who is told what went wrong can at
     least reload. */
  Promise.resolve().then(start).catch(e => {
    pickersOff();
    msg('The video hub could not start: ' + ((e && e.message) || 'error'));
  });
}

return { boot, listingPath, judge, gameLabel, dayText, periodWords,
         shortCoverage, coverageNote, placingNote, MIN_SCORE_READS, VIDEO_COLS };
}));
