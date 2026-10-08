'use strict';
/* ============================================================================
   Player profile.

   Reached from every place a player's name appears — box score, leaders, the
   season table, a team's roster — by id, so a rename never breaks the link.
   ?p= accepts either the uuid or the slug; ids are what the tables link with
   and slugs are what a person would type.

   A minor is withheld by RLS, so this page simply gets nothing back for one
   and says so. It never has to remember to check.
   ============================================================================ */

const CFG = window.EPINOIA_CONFIG;
const T = window.EpinoiaTable;
/* WHICH PLAYER: the address's ?p= - or, on the copy of this page that tools/build-seo.py writes for one
   player (p/<name>.html, whose head carries that player's title, description and structured data for
   search engines), the id in <meta name="epinoia-entity">. The query wins, so a ?p= link on a copy
   still shows the player it names. A meta tag rather than a script: the page's CSP allows no inline script. */
const want = new URLSearchParams(location.search).get('p') ||
  ((document.querySelector('meta[name="epinoia-entity"]') || {}).content || '');
const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(want);

const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const n1 = (v, d = '—') => (v == null ? d : Number(v).toFixed(1));
/* 1st, 2nd, 3rd, 4th … 11th-13th are the exceptions that catch naive code */
const ord = n => { const v = Math.round(n), t = v % 100;
  if (t >= 11 && t <= 13) return v + 'th';
  return v + ({ 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th'); };

/* ---------------------------------------------------------------- access ---
   WHAT THIS VIEWER MAY SEE (docs/memberships.md), decided once, from the league of the
   player's current club, before the first gated section is drawn, and handed down as flags.
   Both answers start open and stay open unless access.js is on the page AND has an answer:
   analytics fail open, and the members-only card needs a known "cannot view". A free agent
   has no league to ask about, so his page is never gated. */
let ANALYTICS_LOCKED = false;
/* EACH SECTION ASKS FOR ITS OWN LOCK (0222): the platform can open one to everyone, or put it behind a report. A key
   with no answer falls back to the analytics one. */
const PLAYER_LOCK_KEYS = ['events', 'splits', 'shotZones', 'wowy'];
let PLAYER_LOCKS = {};
const pLocked = k => (Object.prototype.hasOwnProperty.call(PLAYER_LOCKS, k) ? PLAYER_LOCKS[k] : ANALYTICS_LOCKED);
let ACCESS_LEAGUE = { id: null, slug: '' };
const accessTeaser = o => { const A = window.EpinoiaAccess;
  return A && typeof A.teaserHTML === 'function'
    ? A.teaserHTML(Object.assign({ leagueSlug: ACCESS_LEAGUE.slug }, o)) : ''; };

/* A MEMBERS-ONLY LEAGUE IS REFUSED BY ROW-LEVEL SECURITY, so a member's reads say who is
   asking: access.js hands back a token only for a members-only league this viewer may see and
   {} otherwise, so an open league's request is exactly what it was. A 401 with a token on it
   is a token the server stopped accepting: asked once more anonymously, as it always was. */
async function api(p, anon) {
  const headers = { apikey: CFG.supabaseAnonKey, Accept: 'application/json' };
  const A = window.EpinoiaAccess;
  if (!anon && A && typeof A.authHeaders === 'function') {
    try { Object.assign(headers, A.authHeaders() || {}); } catch (_) { /* anonymous */ }
  }
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${p}`, { cache: 'no-store', headers });
  if (r.status === 401 && headers.Authorization && !anon) return api(p, true);
  if (!r.ok) throw new Error(r.status + ' on ' + p.split('?')[0]);
  return r.json();
}

function fail(msg) {
  $('#seasons').textContent = '';
  $('#seasons').appendChild(el('div', 'empty', msg));
  $('#seasons').hidden = false;
  const shot = $('#seasonShot'); if (shot) { shot.textContent = ''; shot.hidden = true; }
  const view = $('#seasonView'); if (view) view.hidden = true;
  $('#log').textContent = '';
}

/* THE REPORT (report.js, report-playerpages.js; 2026-10-02, in place of the weekly report): his analysis as A4 pages, the
   preview the document. Its data is what this page works out anyway, handed over as each piece is ready (rpGive): the
   season line and its field, the position breakdown, the shots, the lineups and logs of "on the floor with". A piece
   that never comes (no club, a locked league) is handed over as nothing after a while, and its page says so. */
const RP_WAIT = {};
function rpSlot(k) { if (!RP_WAIT[k]) { let res; RP_WAIT[k] = { p: new Promise(r => { res = r; }), res, done: false, v: null }; } return RP_WAIT[k]; }
function rpGive(k, v) { const w = rpSlot(k); w.v = v; if (!w.done) { w.done = true; w.res(v); } }
function rpGet(k, ms) { const w = rpSlot(k); return w.done ? Promise.resolve(w.v) : Promise.race([w.p, new Promise(r => setTimeout(() => r(w.v), ms || 120000))]); }
let REPORT = null, PL_LISTED = '', SCOPE_GAMES = [], RP_SEASON = null;      // RP_SEASON: the season shown (boot's SEASON)
let RP_FIELD = null;                                                       // the scope's games with their logs, once
let RP_PRIOR = null;                                                       // the league's other seasons, once a scope
const RP_LOG_GAMES = 600;
function reportTab(pl, name, team) {
  const E = window.EpinoiaReport, RPm = window.EpinoiaReportPlayer;
  if (!E || !RPm || !pl || !pl.id || REPORT) return;
  const lg = (team && team.leagues) || {};
  const logo = (path, px) => (path && window.epinoiaLogoUrl ? window.epinoiaLogoUrl(path, px) : null);
  const scopeText = () => {
    const comps = RP_SEASON ? RP_SEASON.comps.filter(c => !SCOPE_IDS || SCOPE_IDS.indexOf(c.id) >= 0) : [];
    return [comps.map(c => c.short || compName(c)).filter(Boolean).join(' + '), RP_SEASON && RP_SEASON.label].filter(Boolean).join(' ');
  };
  /* THE REPORT OVER EVERY COMPETITION OF HIS SEASON (Louie, 2026-10-07): his SLB line and his EuroCup line as one, each
     linked profile's rows (0178: playerScopes' pid of each competition) counted as his and summed before any rate is worked
     out (data.js season, opts.alias). Ranked against the field of the competition shown on the page all the same: the
     report says so. Offered when his season has more than one competition. */
  let RP_COMBINE = false, RP_JOINT = null;
  const jointComps = () => (RP_SEASON && RP_SEASON.comps && RP_SEASON.comps.length > 1 ? RP_SEASON.comps : null);
  const jointLabel = () => { const cs = jointComps(); return cs ? cs.map(c => c.short || c.name).filter(Boolean).join(' + ') : ''; };
  const jointLine = async () => {
    const cs = jointComps(), D = window.EpinoiaData;
    if (!cs || !D) return null;
    const key = cs.map(c => c.id + ':' + c.pid).join(',');
    if (RP_JOINT && RP_JOINT.key === key) return RP_JOINT.p;
    const p = (async () => {
      const alias = { player: new Map(cs.filter(c => c.pid && c.pid !== pl.id).map(c => [c.pid, pl.id])) };
      /* only the games of his clubs in those competitions: his line is what is wanted, not the competitions' */
      const gids = [];
      for (const c of cs) {
        const tids = (c.teams || []).filter(Boolean);
        if (!tids.length) continue;
        (await D.all(`games?competition_id=eq.${c.id}&status=eq.final&or=(home_team_id.in.(${tids.join(',')}),away_team_id.in.(${tids.join(',')}))&select=id`))
          .forEach(g => gids.push(g.id));
      }
      if (!gids.length) return null;
      const Sub = await D.season(cs.map(c => c.id), { rows: false, trim: true, gameIds: gids, alias });
      return Sub.players.find(r => r.id === pl.id) || null;
    })();
    RP_JOINT = { key, p };
    p.catch(() => { RP_JOINT = null; });
    return p;
  };
  const ctx = {
    /* his season's field, with the league's other seasons to rank against (report.js loadPrior, read once a scope) */
    bars: async () => {
      const B = await rpGet('bars');
      if (!B || !B.mine) return B;
      const key = (SCOPE_IDS || []).join(',');
      if (!RP_PRIOR || RP_PRIOR.key !== key) RP_PRIOR = { key, p: E.loadPrior(api, team && (team.league_id || (team.leagues && team.leagues.id)), SCOPE_IDS || [], 'all', 4).catch(() => []) };
      const out = Object.assign({}, B, { prior: await RP_PRIOR.p });
      if (RP_COMBINE) {
        const J = await jointLine().catch(e => { console.warn('[report, every competition]', e); return null; });
        if (J) {
          Object.keys(B.mine).forEach(k => { if (!(k in J)) J[k] = B.mine[k]; });      // his name, position and the rest
          J.id = B.mine.id;                                                             // his place in the field is his row's
          out.mine = J;
          out.field = (B.field || []).map(r => (r === B.mine ? J : r));
          if (out.field.indexOf(J) < 0) out.field = out.field.concat(J);
        }
      }
      return out;
    },
    scopeKey: () => (RP_COMBINE ? 'all' : 'home'),
    pos: () => rpGet('pos', 60000),
    shots: () => rpGet('shots'),
    floor: () => rpGet('floor'),
    week: () => window.EpinoiaWeekly ? window.EpinoiaWeekly.playerWeek(api, pl.id, { name, league: ACCESS_LEAGUE.slug, days: 7 }) : null,
    /* the league's games of the scope shown (RAPM is the league's regression; report.js keeps it per set of games) */
    gameIds: async () => { await rpGet('bars').catch(() => null); return SCOPE_GAMES.slice(); },
    /* every game of the scope with its frozen starters and its log, read once, for what only the play-by-play of the
       whole competition can rank (half-court AST%, report.js hcAssists); a competition of more than RP_LOG_GAMES games
       is not read in a browser, and the figure is left blank */
    fieldGames: () => RP_FIELD || (RP_FIELD = (async () => {
      const ids = await ctx.gameIds();
      const D = window.EpinoiaData;
      if (!D || !ids.length || ids.length > RP_LOG_GAMES) return null;
      const rows = [];
      for (let i = 0; i < ids.length; i += 80) rows.push(...await D.all('games?id=in.(' + ids.slice(i, i + 80).join(',') + ')&select=id,starters'));
      const evs = await D.events(rows.filter(g => Array.isArray(g.starters)).map(g => g.id));
      const by = {}; evs.forEach(e => { (by[e.gameId] = by[e.gameId] || []).push(e); });
      return rows.filter(g => by[g.id]).map(g => ({ id: g.id, starters: g.starters, events: by[g.id] }));
    })().catch(() => null)),
    bigGames: (window.EpinoiaData && window.EpinoiaData.BIG_GAMES) || 0,
    rapm: window.EpinoiaRAPM ? ((ids, onProgress) => {
      if (!ids || !ids.length) return Promise.reject(new Error('no games in this scope'));
      return window.EpinoiaRAPM.season(window.EpinoiaData, ids, onProgress).then(r => r.rapm);
    }) : null
  };
  REPORT = E.mount({
    tabs: '#ptabs', panel: '#reportsec', kind: 'player', id: pl.id, label: 'Scouting Report',
    /* the player report is sold on its own (0220, access.js CATALOGUE.locks.playerReport); the league is read when
       the check is made, as the page learns it after the tab is drawn */
    lock: { key: 'playerReport', what: 'The player report', get league() { return ACCESS_LEAGUE.id; }, get leagueSlug() { return ACCESS_LEAGUE.slug; },
            lines: ['A printable A4 scouting report on any player: main stats by position, his shot chart, on and off the floor.'] },
    modules: RPm.modules(ctx),
    /* THE INSIGHTS (scoutinsights.js): the scout's read of him from the line and the field the pages draw */
    insights: async () => {
      const SI = window.EpinoiaScoutInsights;
      if (!SI) return '';
      const B = await ctx.bars();
      if (!B || !B.mine || !Array.isArray(B.field)) return '';
      return SI.html(SI.player({ mine: B.mine, field: B.field }, { name }), { scope: scopeText() });
    },
    /* the competitions (report.js): the one shown on the page, or all of his season's (jointLine) */
    scopes: async () => {
      await rpGet('bars', 60000).catch(() => null);
      const lab = jointLabel();
      return lab ? [{ k: 'home', label: scopeText() || 'as on the page' }, { k: 'all', label: lab + ' (his whole season)' }] : [{ k: 'home', label: scopeText() }];
    },
    setScope: k => { RP_COMBINE = k === 'all' && !!jointComps(); },
    context: () => ({
      kind: 'player', name, club: team && team.name, listedPos: PL_LISTED,
      crest: logo(team && team.logo_path, 512), colour: (team && team.colour) || '#93f2bf',
      accent: E.inkOn ? E.inkOn(team && team.colour) : '#08603f',
      monogram: team && team.short_name && team.short_name.length <= 4 ? team.short_name : null,
      line: [team && team.name, lg.name].filter(Boolean).join(' · '),
      scope: RP_COMBINE ? jointLabel() + (RP_SEASON && RP_SEASON.label ? ' ' + RP_SEASON.label : '') : scopeText(),
      subtitle: RP_COMBINE ? jointLabel() + (RP_SEASON && RP_SEASON.label ? ' ' + RP_SEASON.label : '') + ' · ranked among the players of ' + scopeText() : scopeText(),
      /* what he is ranked against, where that is not what his line is over */
      field: RP_COMBINE ? scopeText() : null
    })
  });
}

/* --------------------------------------------------------------- identity --- */
function paintIdentity(pl, entry, team) {
  const name = ((pl.first_name || '') + ' ' + (pl.last_name || '')).trim();
  $('#name').textContent = name;
  /* the copy tools/build-seo.py wrote for him already has his title (team and league in it); keep that one */
  if (!document.querySelector('meta[name="epinoia-entity"]')) document.title = name + ' · Epinoia';
  PL_LISTED = (entry && entry.position) || '';
  reportTab(pl, name, team);
  /* follow the player: his line after every game */
  if (window.EpinoiaFollow && pl.id) {
    const fb = window.EpinoiaFollow.bell('player', pl.id, { cls: 'big', label: 'follow' });
    fb.classList.add('lbl'); const act = $('#idactions'); if (act) act.appendChild(fb); else $('#name').insertAdjacentElement('afterend', fb);
  }
  suggestable(pl, entry, name);

  const colour = (team && team.colour) || '#93f2bf';
  document.documentElement.style.setProperty('--team-a', colour);
  /* THE PLAYER IN HIS CLUB'S COLOURS. A club with colours of its own (read from its crest,
     or chosen) dresses the page -- body.themed in the stylesheet; a club still on the site's
     default mint leaves the page in the site's own. */
  const TC = window.EpinoiaTeamColour;
  const themed = !!(TC && team && team.colour && String(team.colour).toLowerCase() !== '#93f2bf' &&
                    TC.apply(document.documentElement, team.colour, team.colour_2));
  document.body.classList.toggle('themed', themed);

  /* Photo. media rows are only readable once approved, and a minor's needs
     recorded guardian consent — both enforced in the database, so if a photo
     comes back it is publishable. Initials stand in when it does not. */
  const box = $('#photo');
  /* An approved upload wins over a pasted URL: it has been through moderation
     and the consent check, and it is served from our own CDN rather than
     whatever host someone linked. photo_url stays as the simple fallback. */
  const stored = pl.__photoPath
    ? window.EpinoiaUpload.publicUrl(CFG, pl.__photoPath) : null;
  /* NO PHOTOGRAPH YET: a pixel figure in the club's colours on a small screen (silhouette.js),
     the same one for him every time; the initials only where that module is missing */
  const standIn = () => {
    const SIL = window.EpinoiaSilhouette;
    if (SIL) {
      SIL.mount(box, { seed: pl.id, teamColour: team && team.colour,
        theme: 'auto', shape: 'portrait', label: SIL.label(name) });
      return;
    }
    const ini = $('#ini');
    if (ini) ini.textContent = ((pl.first_name || '?')[0] + (pl.last_name || '')[0] || '').toUpperCase() || '—';
  };
  if (stored || pl.photo_url) {
    const img = document.createElement('img');
    img.src = stored || pl.photo_url;
    img.alt = name;
    img.addEventListener('error', () => { img.remove(); standIn(); });   // never a broken frame
    box.textContent = '';
    box.appendChild(img);
  } else {
    standIn();
  }
  if (entry && entry.jersey) {
    const num = el('span', 'num', entry.jersey);
    if (!themed) num.style.background = colour;
    box.appendChild(num);
  }

  const sub = $('#sub'); sub.textContent = '';
  if (team && team.name) {
    const a = el('a', null, team.name);
    a.href = '../t/?t=' + encodeURIComponent(team.slug || '');
    sub.appendChild(a);
    $('#teamLink').href = a.href;
    /* a divider, then the league he plays in (a name of its own: never translated) */
    const lg = team.leagues;
    if (lg && lg.name) {
      sub.appendChild(el('i', 'sub-div'));
      const la = el(lg.slug ? 'a' : 'span', 'sub-league', lg.name);
      if (lg.slug) la.href = '../l/?l=' + encodeURIComponent(lg.slug);
      la.setAttribute('translate', 'no');
      sub.appendChild(la);
    }
  } else {
    sub.appendChild(el('span', null, 'Free agent'));
    $('#teamLink').style.display = 'none';
  }
  sub.appendChild(el('span', 'sub-break'));      // the club and league on one line, the chips (position, estimated position) on the next
  if (entry && entry.position) {
    const pc = el('span', 'pos-chip', entry.position); pc.setAttribute('data-i18n-ctx', 'pos'); sub.appendChild(pc);
    suggestOn(pc, 'position');
  }
  paintVitals(pl);
  $('#ctx').textContent = [(team || {}).name, name].filter(Boolean).join(' · ');
}

/* ---------------------------------------------------------------- vitals ---
   BORN, AGE, HEIGHT AND WEIGHT, as a row of their own under the club line: a small label over
   each number, a hairline between them, and the units switch at the end. Height and weight are
   shown in whichever units the reader chose (units.js) - one set, not both - and redrawn when
   that changes, here or anywhere else on the site. Only what is known is shown; a player with
   none of the four has no row at all. HIS AGE comes from the database's own function (0184):
   the date of birth is never sent to a browser, and a server without it shows no age. */
let vitalsAge = null, vitalsPl = null, vitalsHooked = false, vitalsAsked = null;
function paintVitals(pl) {
  const host = $('#vitals');
  if (!host) return;
  const U = window.EpinoiaUnits;
  if (vitalsPl && vitalsPl.id !== pl.id) vitalsAge = null;
  vitalsPl = pl;
  const draw = () => {
    const pl = vitalsPl;
    host.textContent = '';
    const item = (k, v, unit) => {
      const d = el('div', 'vit');
      d.appendChild(el('span', 'vk', k));
      const vv = el('span', 'vv', v);
      vv.setAttribute('translate', 'no');
      if (unit) vv.appendChild(el('small', null, unit));
      d.appendChild(vv);
      host.appendChild(d);
      return d;
    };
    if (pl.birth_year) item('born', String(pl.birth_year));
    if (vitalsAge != null) item('age', String(vitalsAge));
    const split = s => { const m = /^(\S+) (\S+)$/.exec(s || ''); return m ? [m[1], m[2]] : [s, '']; };
    const ht = U ? U.height(pl.height_cm) : (pl.height_cm ? pl.height_cm + ' cm' : '');
    const wt = U ? U.weight(pl.weight_kg) : (pl.weight_kg ? pl.weight_kg + ' kg' : '');
    if (ht) suggestOn(item('height', ...split(ht)), 'height_cm');
    if (wt) suggestOn(item('weight', ...split(wt)), 'weight_kg');
    const any = host.childNodes.length > 0;
    if (any && U && (pl.height_cm || pl.weight_kg)) host.appendChild(U.toggle({ className: 'vit-units' }));
    host.hidden = !any;
  };
  draw();
  if (U && !vitalsHooked) { vitalsHooked = true; U.onChange(() => paintVitals(vitalsPl)); }
  if (window.EpinoiaAges && pl.id && vitalsAsked !== pl.id) {
    vitalsAsked = pl.id;
    window.EpinoiaAges.load(CFG, [pl.id]).then(m => {
      if (m[pl.id] != null && vitalsPl && vitalsPl.id === pl.id) { vitalsAge = m[pl.id]; draw(); }
    }).catch(() => { /* no age */ });
  }
}

/* ------------------------------------------------------------ suggestions ---
   A FAN MAY SUGGEST A CORRECTION to what only the club, the league or the platform may change (suggest.js,
   0199). Hovering the name, the photograph, the height, the weight or the position offers it; the button
   beside the follow bell reaches every one of them, the wingspan and the previous club too, which the page
   does not show. Never for a player under 18: their details are the league's alone. */
let suggestFor = null;
const SUGGEST_FIELDS = ['name', 'photo', 'height_cm', 'weight_kg', 'wingspan_cm', 'position', 'previous_club'];
function suggestChoice(field) {
  const s = suggestFor, pl = s.pl;
  return { type: 'player', id: pl.id, field, subject: s.name,
           current: field === 'name' ? { first: pl.first_name, last: pl.last_name }
                  : field === 'position' ? (s.entry && s.entry.position) || null : pl[field] };
}
function suggestOn(node, field, opts) {
  if (node && suggestFor && window.EpinoiaSuggest) window.EpinoiaSuggest.attach(node, suggestChoice(field), opts);
}
function suggestable(pl, entry, name) {
  const S = window.EpinoiaSuggest;
  /* EDIT, for whoever manages him (adminedit.js, 0214), a player under 18 included: the database says who. What it
     saves, his measures and position are redrawn here; his name and photograph by the editor */
  if (window.EpinoiaAdminEdit && pl && pl.id) {
    window.EpinoiaAdminEdit.mount({ type: 'player', id: pl.id, name, host: '#idactions', onSaved: row => {
      ['first_name', 'last_name', 'height_cm', 'weight_kg', 'wingspan_cm', 'previous_club'].forEach(k => { if (k in row) pl[k] = row[k]; });
      if (entry) entry.position = row.position || null;
      const sub = $('#sub');
      let pc = sub && sub.querySelector('.pos-chip:not(.est-pos)');
      if (pc && !row.position) pc.remove();
      else if (row.position && sub) {
        if (!pc) { pc = el('span', 'pos-chip'); pc.setAttribute('data-i18n-ctx', 'pos'); (sub.querySelector('.sub-break') || sub.lastChild).after(pc); }
        pc.textContent = row.position;
      }
      paintVitals(pl);
    } });
  }
  suggestFor = S && pl && pl.id && !pl.is_minor ? { pl, entry, name } : null;
  if (!suggestFor) return;
  suggestOn($('#name'), 'name');
  suggestOn($('#photo'), 'photo', { at: 'inset' });
  const act = $('#idactions');
  if (act && !act.querySelector('.sg-btn')) act.appendChild(S.button(() => SUGGEST_FIELDS.map(suggestChoice), { title: name, cls: 'mini' }));
}

/* --------------------------------------------------------------- released ---
   THE ONE THING THE INJURY REPORT CANNOT WORK OUT. It reads who is missing
   straight out of the box scores (epinoia/injuries.js), which is right for an
   injury and wrong for a player who has simply gone: he will never appear
   again, so he would sit on the wire and on every preview's question marks
   forever. So the club says so, here or on the wire itself — the same
   set_player_released (0132), and the same row either way.

   Only for whoever manages the club, asked of the database rather than assumed,
   and only ever asked when somebody is signed in. It is a toggle: a player who
   comes back is un-released and the report picks him up the moment he plays. */
async function offerRelease(pl, team) {
  if (!pl || !pl.id || !team || !team.id) return;
  /* a reader who is signed out never loads the SDK for this */
  if (!(window.epinoiaMaybeSignedIn && window.epinoiaMaybeSignedIn())) return;
  const sb = window.epinoiaClientReady ? await window.epinoiaClientReady() : null;
  if (!sb) return;
  let released = false;
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    const { data: mine } = await sb.rpc('is_team_manager', { p_team: team.id });
    if (!mine) return;
    const rows = await api(`player_releases?team_id=eq.${team.id}&player_id=eq.${pl.id}&select=player_id&limit=1`);
    released = !!(rows && rows.length);
  } catch (_) { return; }               // no button, which is the safe way to be wrong

  const sub = $('#sub');
  const b = el('button', 'wr-rel' + (released ? ' on' : ''), released ? 'released' : 'mark released');
  b.type = 'button';
  const title = () => b.classList.contains('on')
    ? 'Released from ' + (team.name || 'this club') + ' — press to put them back on the injury report'
    : 'Mark as released from ' + (team.name || 'this club') + ' — they leave the injury report and the game previews';
  b.title = title();
  b.addEventListener('click', async () => {
    const want = !b.classList.contains('on');
    b.disabled = true;
    try {
      const { error } = await sb.rpc('set_player_released',
        { p_team: team.id, p_player: pl.id, p_released: want, p_note: '' });
      if (error) throw error;
      b.classList.toggle('on', want);
      b.textContent = want ? 'released' : 'mark released';
      b.title = title();
    } catch (err) {
      b.title = 'Could not do that: ' + ((err && err.message) || err);
    } finally { b.disabled = false; }
  });
  sub.appendChild(b);
}

/* THE POPUP (statpop.js): the players he is ranked among for a statistic, honouring "adjust for position" */
function statPool(mine, field) {
  const SE = window.EpinoiaSeason;
  if (!barsByPos || !SE || !SE.positionGroups || !mine) return field;
  const pm = SE.positionGroups(field), g = pm.get(mine.id);
  return g ? field.filter(r => pm.get(r.id) === g) : field;
}
function statBind(node, k, label, mine, rows, value) {
  const SP = window.EpinoiaStatPop;
  if (!SP || !mine || !rows || rows.length < 3) return;
  SP.bind(node, () => ({ key: k, label, kind: 'player', subjectId: mine.id, rows, value: value || k, low: BAR_LOW.indexOf(k) !== -1,
    signed: BAR_SIGNED(k), dp: BAR_DP(k) }));
}

function paintTiles(s, field) {
  const host = $('#tiles'); host.textContent = '';
  if (!s) {
    host.appendChild(el('div', 'empty', 'No finalised games yet.'));
    return;
  }
  const rows = field && field.length ? statPool(s, field) : null;
  [['games', s.gp, false, null], ['pts', n1(s.ppg), true, 'ppg'], ['reb', n1(s.rpg), true, 'rpg'],
   ['ast', n1(s.apg), true, 'apg'], ['mins', n1(s.mpg), false, 'mpg'],
   ['ts%', n1(s.ts), false, 'ts'], ['usg%', n1(s.usg), false, 'usg'],
   ['on-off', s.diff_net == null ? '—' : (s.diff_net > 0 ? '+' : '') + n1(s.diff_net), true, 'diff_net']]
    .forEach(([l, v, hi, k]) => {
      const d = el('div', 'tile' + (hi ? ' hi' : ''));
      d.append(el('div', 'v', v), el('div', 'l', l));
      if (k) statBind(d, k, l, s, rows);
      host.appendChild(d);
    });
}

/* ------------------------------------------------------------ percentile --- */
/* index_9's profile bars. Each row is where this player ranks in the
   competition for that statistic, which turns a number nobody has a feel for
   ("11.4 AST%") into one anybody can read ("83rd percentile").

   Rates only. Ranking a total would just rank minutes played. */
/* [key, label]
   Every row is a percentile bar against the rest of the competition.

   Each shooting rate is followed by its OWN VOLUME ROW, ranked the same way.
   A rate without its volume is unreadable — 60% at the rim means one thing on
   eight attempts a night and nothing at all on one — but a volume printed as a
   bare number beside the rate is barely better, because nobody knows whether
   four rim attempts a game is a lot. Ranked against the league, it answers
   both questions at once: how often he goes there, and how he does when he
   gets there. Those are different skills and they deserve different bars.

   THE SECTIONS ARE CARDS (cards.js): each folds away, and each bar in it is a card of its own with the
   gap to the league average under it. A section is a list of BLOCKS. A block with a title is a group inside
   the card: the shooting card's four distances are grouped (not folded), and the impact card keeps its
   on/off and box plus/minus blocks open while the two four-factor blocks are folds of their own. */
const BAR_SECTIONS = [
  { key: 'scoring', title: 'scoring', blocks: [
    { rows: [['ppg','PTS / GAME'],['ts','TS%'],['efg','eFG%'],['usg','USAGE'],['ftr','FT RATE'],
             ['ev_ast_pts_sh','ASSISTED%'],
             /* TOTAL POINT CONTRIBUTION per game: the points he scored plus the points scored off his assists
                (index_9's TPC). Total-points-based, so it is a volume, ranked like points a game. */
             ['contrib_pg','TPC / GAME']] }
  ]},
  /* ASSISTED% under each distance: of the shots he MADE there, how many came off a pass.
     Only a make can be assisted -- nobody records the pass before a miss -- so it is a
     share of makes, and the row above it is that distance's accuracy over every attempt.
     ASSISTED% in scoring is the same question of his points: how much of what he scored
     came off somebody's pass, free throws included in the total. */
  { key: 'shooting', title: 'shooting', blocks: [
    { title: 'at the rim',   rows: [['rim_pct','RIM%'], ['rim_a100','RIM ATT / 100'], ['ev_rim_astp','RIM ASSISTED%'], ['team_spacing','TEAM SPACING']] },
    { title: 'mid-range',    rows: [['mid_pct','MID%'], ['mid_a100','MID ATT / 100'], ['ev_mid_astp','MID ASSISTED%']] },
    { title: 'three-pointers', consistency: true, rows: [['p3_pct','3P%'],  ['p3_a100','3P ATT / 100'],  ['ev_p3_astp','3P ASSISTED%']] },
    { title: 'free throws',  rows: [['ft_pct','FT%'],   ['ft_a100','FT ATT / 100']] }
  ]},
  { key: 'playmaking', title: 'playmaking', blocks: [
    { rows: [['ast_pct','ASSIST%'],['au','AST / USG'],['ast_to','AST / TO'],['tov_pct','TURNOVER%']] }
  ]},
  { key: 'rebounding', title: 'rebounding', blocks: [
    { rows: [['oreb_pct','OREB%'],['dreb_pct','DREB%'],['trb_pct','TOTAL REB%'],
             ['orb_tm_pct','ORB% ON TEAM MISSES'],['orb_self_pct','ORB% ON OWN MISSES']] }
  ]},
  { key: 'defence', title: 'defence', blocks: [
    { rows: [['stl_pct','STEAL%'],['blk_pct','BLOCK%'],['pf30','FOULS CONCEDED / 30']] },
    /* bigsOnly: drawn only for a player whose estimated position group is C or F (paintBars) */
    { title: 'rim protection', bigsOnly: true, rows: [['def_rim_fg_pm','DEF RIM FG% \u00B1'],['def_rim_vol_pm','DEF RIM VOL \u00B1']] }
  ]},
  /* IMPACT: on/off as differentials -- how much better the team is in each with him on -- and the box
     plus/minus family. The four factors are shown in full, offence and defence, each end its own fold. */
  { key: 'impact', title: 'impact', blocks: [
    { title: 'on / off', rows: [['diff_net','NET ±'],['diff_ortg','ORTG ±'],['diff_drtg','DRTG ±']] },
    /* VORP is a season's worth of value over a replacement player, so it carries his minutes as well as his level */
    { title: 'box plus / minus', rows: [['bpm','BPM'],['obpm','OBPM'],['dbpm','DBPM'],['vorp','VORP']] },
    { title: 'offence four factors', fold: true, note: 'team, with him on vs off',
      rows: [['diff_efg','eFG% ±'],['diff_tov','TOV% ±'],['diff_oreb','OREB% ±'],['diff_ftr','FT RATE ±']] },
    { title: 'defence four factors', fold: true, note: 'opponents, with him on vs off',
      rows: [['diff_vs_efg','OPP eFG% ±'],['diff_vs_tov','OPP TOV% ±'],['diff_vs_oreb','OPP OREB% ±'],['diff_vs_ftr','OPP FT RATE ±']] }
  ]}
];
/* SIMPLE VIEW: THE BOX SCORE, PER 75 POSSESSIONS (index_9's "per 75 lineup possessions"). Each count is put over the
   possessions his team had while he was on the floor (vsunits.js per75, on season.js on_poss), so twelve minutes a night
   and thirty-six read at the same rate, and no one is flattered by his team's pace. The three shooting percentages
   beside them are the box score's own. Every bar is ranked and opens its chart like any other. */
const SIMPLE_SECTIONS = [
  { key: 'simple_scoring', title: 'scoring', blocks: [
    { rows: [['pts_p75','PTS / 75']] },
    { title: 'field goals',    rows: [['fg_pct','FG%'], ['fgm_p75','FGM / 75'], ['fga_p75','FGA / 75']] },
    { title: 'three-pointers', rows: [['p3_pct','3P%'], ['p3m_p75','3PM / 75'], ['p3a_p75','3PA / 75']] },
    { title: 'free throws',    rows: [['ft_pct','FT%'], ['ftm_p75','FTM / 75'], ['fta_p75','FTA / 75']] }
  ]},
  { key: 'simple_rebounding', title: 'rebounding', blocks: [
    { rows: [['reb_p75','REB / 75'],['oreb_p75','OREB / 75'],['dreb_p75','DREB / 75']] }
  ]},
  { key: 'simple_playmaking', title: 'playmaking', blocks: [
    { rows: [['ast_p75','AST / 75'],['tov_p75','TOV / 75']] }
  ]},
  { key: 'simple_defence', title: 'defence', blocks: [
    { rows: [['stl_p75','STL / 75'],['blk_p75','BLK / 75'],['pf_p75','PF / 75']] }
  ]}
];
const BAR_GROUPS = BAR_SECTIONS.map(s => [s.title, s.blocks.flatMap(b => b.rows)]);   // the flat view: every row of a section
/* the ones where a smaller number is the better performance */
/* ASSISTED% RANKS THE OTHER WAY UP. Every other bar here reads high-is-better, but a
   basket somebody else created is the easier one to make: between two players shooting
   the same percentage from the same distance, the one doing it off his own dribble is
   the rarer player. So the LEAST assisted scoring takes the top percentile, and the bar
   fills for the share he created himself. (For a CLUB the opposite is true — ball
   movement — which is why this list is the player profile's alone.)
   The defensive four factors: the team's opponents shooting, rebounding and getting to the line LESS with him on
   is the good direction; opponent turnovers going UP is (so diff_vs_tov is not here). Fouls conceded: fewer is better. */
const BAR_LOW = ['tov_pct', 'diff_drtg', 'diff_tov', 'pf30',
                 'diff_vs_efg', 'diff_vs_oreb', 'diff_vs_ftr',
                 'ev_ast_pts_sh', 'ev_rim_astp', 'ev_mid_astp', 'ev_p3_astp',
                 'def_rim_fg_pm', 'def_rim_vol_pm', 'tov_p75', 'pf_p75'];
/* a differential (or a plus/minus) carries its sign: +12.5 is a claim, 12.5 is a number */
const BAR_SIGNED = k => /^diff_/.test(k) || k === 'bpm' || k === 'obpm' || k === 'dbpm' ||
  k === 'def_rim_fg_pm' || k === 'def_rim_vol_pm';
const BAR_DP = k => (k === 'ast_to' || k === 'au') ? 2 : 1;
const BAR_HINT = {
  contrib_pg: 'Total point contribution per game: the points he scored plus the points scored off his assists.',
  vorp: 'Value over replacement player: box plus/minus turned into a season total, so minutes count as well as level.',
  pf30: 'Personal fouls he commits per 30 minutes on the floor. Fewer is better, so the top percentile fouls least. ' +
    'Left blank under 20 minutes played.',
  orb_tm_pct: 'Of the field-goal misses by his teammates while he is on the floor that ended in a rebound, the share he grabbed himself as an offensive rebound.',
  orb_self_pct: 'Of his own missed field goals that ended in a rebound (either side, team rebounds included), the share he got back himself as an offensive rebound.',
  def_rim_fg_pm: 'Opponents\u2019 field-goal percentage at the rim with him on the floor minus with him off it. Lower (negative) is better.',
  def_rim_vol_pm: 'Opponents\u2019 rim attempts per 100 of their possessions with him on the floor minus with him off it. Lower (negative) is better.',
  team_spacing: 'How stretched the floor is around him: the points his teammates\u2019 threes are worth per 100 possessions while he is on the floor ' +
    '(their three-point volume and accuracy in one number, his own threes left out). Higher means more room to work in.'
};

/* THE FIVE-BAND SCALE the table's heat map uses, in --good rather than --lume: this page wears the club's
   colours (--lume is its ink), and a good number must stay green */
function barBand(p) {
  return p == null ? 'var(--rule-2)'
    : p >= 75 ? 'var(--good)' : p >= 50 ? 'color-mix(in oklch,var(--good) 70%,var(--amber))'
    : p >= 25 ? 'var(--amber)' : 'var(--flare)';
}

/* ADJUSTED FOR POSITION: the same bars, ranked inside his own position group.
   A centre's assist rate against every player in the competition says only that he
   is a centre; against other centres it says whether he passes. The group comes
   from season.js positionGroup -- the calculated position corrected by the listed
   one -- and the choice is remembered for the next profile opened. */
let barsByPos = false;
try { barsByPos = localStorage.getItem('epinoia_bars_pos') === '1'; } catch (_) { /* default */ }
/* SCOUTING VIEW (every bar above) OR SIMPLE VIEW (the per-75 box score), and ALL OR AGAINST THE STARTERS OR THE BENCH:
   both remembered for the next profile opened, like the position switch */
let barsView = 'scout', barsVs = 'all';
try { barsView = localStorage.getItem('epinoia_bars_view') === 'simple' ? 'simple' : 'scout'; } catch (_) { /* default */ }
try { const v = localStorage.getItem('epinoia_bars_vs'); if (v === 'start' || v === 'bench') barsVs = v; } catch (_) { /* default */ }
const keep = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* fine */ } };
/* SIMILAR PLAYERS (similar.js, p/similar-ui.js): the panel that takes the bars' place. SIM_CTX is the line it is asked about
   (the competition and the profile he played it under; null where there is none), SIM_CTL the panel drawn from its file */
let simOpen = false, SIM_CTX = null, SIM_CTL = null;
/* COMPARE PLAYER (p/compare-ui.js): CMP_CTX is the line the picker sets against another -- this one, its field and what the
   chart calls it (null where there is no line); cmpOpen keeps the picker open through a redraw of the bars */
let CMP_CTX = null, cmpOpen = false;

/* ONE BAR, IN ITS OWN CARD: label and value across the top with his percentile under the value, the fill,
   and under it how far the value sits above or below the league average (the field the bar is ranked in) */
function barCard(k, label, mine, ranks, pool) {
  const C = window.EpinoiaCards;
  const v = mine[k];
  const p = (ranks.get(k) || new Map()).get(mine.id);
  const card = el('div', 'bc');
  /* volume rows are visibly subordinate to the rate they belong to, so
     the group still reads as shot types rather than a wall of statistics */
  if (/ATT \/ 100$/.test(label)) card.classList.add('vol');
  if (v == null) card.classList.add('none');
  if (BAR_HINT[k]) card.title = BAR_HINT[k];
  card.style.setProperty('--bc-band', barBand(p));
  if (v != null) statBind(card, k, label, mine, pool);

  const top = el('div', 'bc-top');
  top.appendChild(el('div', 'bc-l', label));
  const dp = BAR_DP(k);
  const val = el('div', 'bc-v', v == null ? '—' : ((BAR_SIGNED(k) && Number(v) > 0 ? '+' : '') + Number(v).toFixed(dp)));
  if (p != null) { const bp = el('div', 'bp', ord(p)); bp.setAttribute('data-i18n-ctx', 'pctl'); val.appendChild(bp); }
  top.appendChild(val);
  card.appendChild(top);

  const track = el('div', 'bc-track');
  const fill = el('i');
  fill.style.width = (p == null ? 0 : Math.max(2, p)) + '%';
  fill.style.background = barBand(p);
  track.appendChild(fill);
  card.appendChild(track);

  const d = C ? C.delta(v, C.mean(pool, k), BAR_LOW.indexOf(k) !== -1, dp) : null;
  if (d) {
    const row = el('div', 'bc-d ' + d.dir + ' ' + d.tone);
    row.appendChild(el('b', null, d.text));
    row.appendChild(el('span', null, 'lg avg ' + ((BAR_SIGNED(k) && d.avg > 0) ? '+' : '') + d.avg.toFixed(dp)));
    card.appendChild(row);
  }
  return card;
}

/* ------------------------------------------------- against the starters and the bench ---
   HIS OWN NUMBERS IN THE MINUTES AGAINST THE OTHER SIDE'S STARTERS, OR ITS BENCH (index_9's player VS Starters; the
   club page's split and its rule): vsunits.js replays the games this page has already read for "on the floor with",
   cuts his minutes wherever either five changes, and turns each part into a season line with season.js. ALL is the
   baseline: each bar shows the part, ranked where it would sit among the same players, with a tick where all his
   minutes sit and the gap to them under it. Nothing is read until somebody asks: the engine, and the scope's starters
   (one small read, for who the regular starters are; not for a competition past VS_BIG games, which keeps to each
   game's own starting five). Worked out once per scope, then kept for the page's life. */
const VS_BIG = 800;
let SCOPE_GAME_COUNT = 0;
/* the club's games "on the floor with" has read: { games, byGame, capped }, or null when it reads none */
let clubLogsDone = () => {};
const CLUB_LOGS = new Promise(r => { clubLogsDone = r; });
const STARTERS_READ = new Map(), VS_DONE = new Map(), VS_WAIT = new Map();
function scopeStarters(ids) {
  const D = window.EpinoiaData, key = ids.slice().sort().join(',');
  if (!D || !key) return Promise.resolve([]);
  if (STARTERS_READ.has(key)) return STARTERS_READ.get(key);
  const p = D.all(`games?competition_id=in.(${key})&status=eq.final&select=id,home_team_id,away_team_id,starters`);
  p.catch(() => STARTERS_READ.delete(key));
  STARTERS_READ.set(key, p);
  return p;
}
/* the club card's N (t/seasonline.js, kept in this browser): starts that make a regular starter */
function vsMinStarts() {
  try {
    const v = JSON.parse(localStorage.getItem('epinoia_vs_starters') || 'null');
    const n = v && Math.round(+v.min);
    if (n >= 1 && n <= 40) return n;
  } catch (_) { /* the default */ }
  return 10;
}
async function vsCompute(ids, pid) {
  const VU = window.EpinoiaVsUnits, SE = window.EpinoiaSeason;
  if (!VU || !SE) return { state: 'none', why: 'not available on this page' };
  const [logs, E] = await Promise.all([CLUB_LOGS, VU.loadEngine()]);
  if (!E) return { state: 'none', why: 'the replay could not be loaded' };
  if (!logs || !logs.games.length) return { state: 'none', why: 'no play-by-play has been read for his club' };
  const scope = new Set(ids);
  const games = logs.games.filter(g => scope.has(g.competition_id));
  if (!games.length) return { state: 'none', why: 'none of his club’s games in this scope has been read' };
  const N = vsMinStarts();
  let regular = new Map(), byRegular = false;
  if (SCOPE_GAME_COUNT <= VS_BIG) {
    try { regular = VU.regularStarters(await scopeStarters(ids), N); byRegular = true; } catch (_) { /* each game's own five */ }
  }
  const sp = VU.split(games.map(g => ({ id: g.id, starters: g.starters, events: logs.byGame.get(g.id) || [], period: g.period,
    home_team_id: g.home_team_id, away_team_id: g.away_team_id })), pid, { regular, Engine: E });
  if (!sp.games) return { state: 'none', why: 'he has not played in the games read' };
  return { state: 'ready', lines: VU.lines(sp, SE), games: sp.games, capped: logs.capped,
           min: { all: sp.all.min, start: sp.start.min, bench: sp.bench.min }, N, byRegular };
}
/* ------------------------------------------------------------------ clutch time --- */
/* HIS CLUTCH TIME (Louie, 2026-10-07; clutch.js, as the club page's 08 Clutch time reads it): his club's games in the scope
   shown (the same logs "on the floor with" reads: the club's last forty), the last four minutes of the fourth quarter and
   overtime while within five points. Shown only once he has five minutes of it: his usage, his true shooting against the
   club's in clutch time, the club's net rating with him on the floor against the club's clutch net, his line, and the
   possessions it rests on. Behind the splits lock, as the club page's is. */
const P_CLUTCH_MIN_SEC = 300;
let CLUTCH_RUN = 0;
/* DATA (2026-10-07): the replay engine (vsunits.js loadEngine) is fetched for this only once the reader comes near the
   bottom of the page (the shot chart, a screen or so away); a visit that reads the top and leaves fetches nothing for it.
   A later scope change draws it again at once */
let clutchArgs = null, clutchArmed = false, clutchSeen = false;
function clutchWhenNear(ids, pid, club) {
  clutchArgs = [ids, pid, club];
  const go = () => { clutchSeen = true; paintClutch.apply(null, clutchArgs).catch(() => {}); };
  if (clutchSeen) { go(); return; }
  if (clutchArmed) return;
  clutchArmed = true;
  const node = $('#shotsec') || $('#clutchsec');
  if (!node || typeof IntersectionObserver !== 'function') { go(); return; }
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: '600px 0px' });
  io.observe(node);
}
async function paintClutch(ids, pid, club) {
  const sec = $('#clutchsec'), host = $('#pclutch'), CL = window.EpinoiaClutch, VU = window.EpinoiaVsUnits;
  if (!sec || !host) return;
  const run = ++CLUTCH_RUN;
  const show = on => { if (run === CLUTCH_RUN) sec.style.display = on ? '' : 'none'; };
  if (!CL || !VU || !club || !pid || !(ids || []).length) { show(false); return; }
  try {
    const [logs, E] = await Promise.all([CLUB_LOGS, VU.loadEngine()]);
    if (run !== CLUTCH_RUN) return;
    if (!logs || !E || !logs.games || !logs.games.length) { show(false); return; }
    const scope = new Set(ids);
    const games = logs.games.filter(g => scope.has(g.competition_id) && Array.isArray(g.starters));
    const S = CL.season(games.map(g => ({ game: { id: g.id, starters: g.starters, period: g.period, events: logs.byGame.get(g.id) || [] },
      side: g.home_team_id === club.id ? 0 : 1 })));
    const p = S.players[pid];
    if (!p || !(p.sec >= P_CLUTCH_MIN_SEC)) { show(false); return; }
    show(true);
    if (pLocked('splits')) {
      host.innerHTML = accessTeaser({ compact: true, key: 'splits', title: 'Clutch time',
        lines: ['His usage and shooting in the last four minutes of a close game, and how the club does with him on the floor.'] });
      return;
    }
    const num = v => v != null && v !== '' && isFinite(+v);
    const f1 = v => (num(v) ? (+v).toFixed(1) : '—'), sg = v => (num(v) ? (+v > 0 ? '+' : '') + (+v).toFixed(1) : '—');
    const tone = (v, ref, low) => (!num(v) || !num(ref) ? '' : Math.abs(v - ref) < 1 ? 'lv' : ((v > ref) !== !!low ? 'up' : 'dn'));
    /* the club with him on the floor: every five he was in */
    const on = { own: {}, opp: {} };
    CL.BOX.forEach(k => { on.own[k] = 0; on.opp[k] = 0; });
    Object.values(S.fives).forEach(f => { if (f.ids.indexOf(pid) < 0) return; CL.BOX.forEach(k => { on.own[k] += f.own[k] || 0; on.opp[k] += f.opp[k] || 0; }); });
    const Ron = CL.ratings(on.own, on.opp), Rall = CL.ratings(S.own, S.opp);
    const sh = CL.shooting(p), clubTs = CL.shooting(S.own).ts, usg = CL.usage(p), poss = Math.round(CL.playerPoss(p));
    host.innerHTML = '';
    const wrap = el('div', 'tclx');
    const tile = (val, lab, em, cls) => { const t = el('div', 'tclx-tile ' + (cls || '')); t.append(el('b', null, val), el('span', null, lab), el('em', null, em)); return t; };
    const tiles = el('div', 'tclx-tiles');
    tiles.append(
      tile(f1(usg) + '%', 'CLUTCH USAGE', 'one in five is a fair share', 'st'),
      tile(f1(sh.ts), 'CLUTCH TS%', 'club in clutch ' + f1(clubTs), tone(sh.ts, clubTs, false)),
      tile(sg(Ron.net), 'NET WITH HIM ON', 'club in clutch ' + sg(Rall.net), tone(Ron.net, Rall.net, false)),
      tile(String(p.pts), 'CLUTCH POINTS', (p.games || 0) + (p.games === 1 ? ' game' : ' games'), 'st'));
    wrap.appendChild(tiles);
    const secs = Math.round(p.sec), mm = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
    wrap.appendChild(el('p', 'tclx-sample', poss + ' clutch possessions on the floor over ' + mm + ' minutes in ' + (p.games || 0) + (p.games === 1 ? ' game' : ' games') +
      (poss < 40 ? ' · a small sample: a basket or two moves these a long way' : '')));
    const line = el('div', 'tclx-line');
    [['MIN', mm], ['POSS', String(poss)], ['PTS', String(p.pts)], ['FG', p.fgm + '/' + p.fga], ['3P', p.p3m + '/' + p.p3a],
     ['FT', p.ftm + '/' + p.fta], ['TOV', String(p.tov)], ['REB', String((p.or || 0) + (p.dr || 0))]].forEach(([l, v]) => {
      const c = el('div'); c.append(el('b', null, v), el('span', null, l)); line.appendChild(c);
    });
    wrap.appendChild(line);
    wrap.appendChild(el('p', 'tclx-note', 'Clutch time is the last four minutes of the fourth quarter (the second half, in halves) and all of overtime, while the score is within five points going into the play, worked out from the play-by-play of his club’s games in this scope' + (logs.capped ? ' (its last ' + logs.capped + ')' : '') + '. Usage is the share of the club’s plays he ended while on the floor in it; TS% is coloured against the club’s clutch TS%, and the net rating with him on against the club’s in all its clutch time. Possessions are the club’s while he was on the floor (estimated).'));
    host.appendChild(wrap);
    const note = $('#clutchNote');
    if (note) note.textContent = (p.games || 0) + (p.games === 1 ? ' game' : ' games') + ' · ' + mm + ' minutes · ' + poss + ' possessions';
  } catch (e) {
    console.warn('[clutch]', e);
    show(false);
  }
}

/* this scope's split: { state: 'wait' } until it is worked out, and the bars are drawn again when it is */
function vsLines(mine) {
  const ids = (SCOPE_IDS || []).slice().sort(), key = ids.join(',');
  if (VS_DONE.has(key)) return VS_DONE.get(key);
  if (!VS_WAIT.has(key)) {
    VS_WAIT.set(key, vsCompute(ids, mine.id)
      .catch(() => ({ state: 'none', why: 'the play-by-play could not be read' }))
      .then(r => {
        VS_DONE.set(key, r); VS_WAIT.delete(key);
        if (LAST_BARS && barsVs !== 'all') paintBars(LAST_BARS.mine, LAST_BARS.field);
      }));
  }
  return { state: 'wait' };
}
/* what the split is, and how much of his season it covers */
function vsNote(V, unit) {
  const box = el('div', 'vsnote');
  const line = t => box.appendChild(el('span', null, t));
  if (pLocked('splits')) {
    box.innerHTML = accessTeaser({ compact: true, key: 'splits', title: 'Against starters and bench',
      lines: ['His own numbers in the minutes against the other side’s starters, and against its bench, beside all his minutes.'] });
    return box;
  }
  if (!V || V.state === 'wait') { line(unit === 'start' ? 'reading his games against the starters…' : 'reading his games against the bench…'); return box; }
  if (V.state !== 'ready') { line(V.why || 'the play-by-play could not be read'); return box; }
  line(unit === 'bench' ? 'against the bench: every other minute'
    : V.byRegular ? 'against the starters: the other side had 4+ of its regular starters (' + V.N + '+ starts) or 4+ of that game’s starting five on'
    : 'against the starters: the other side had 4+ of that game’s starting five on');
  const m = x => Math.round(x / 60000);
  line(m(V.min[unit]) + ' of his ' + m(V.min.all) + ' minutes, over ' + V.games + (V.games === 1 ? ' game' : ' games') +
    ' with play-by-play' + (V.capped ? ' (his club’s last ' + V.capped + ')' : ''));
  line('the tick on each bar is all his minutes in the same games');
  return box;
}
/* ONE BAR, AGAINST THE STARTERS OR THE BENCH: the part's figure, ranked where it would sit among the same pool as the
   bar's ALL figure (season.js's count), the fill there and a tick where all his minutes sit, the gap to them under it */
function vsCard(k, label, mine, pool, V, unit) {
  const VU = window.EpinoiaVsUnits;
  const part = V.lines[unit], base = V.lines.all;
  const can = VU.splitable(k);
  const v = can && part ? part[k] : null, a = can && base ? base[k] : null;
  const low = BAR_LOW.indexOf(k) !== -1, dp = BAR_DP(k), signed = BAR_SIGNED(k);
  const vals = VU.sortedOf(pool, k);
  const p = VU.placeIn(vals, v, low), pa = VU.placeIn(vals, a, low);
  const fmt = x => (signed && Number(x) > 0 ? '+' : '') + Number(x).toFixed(dp);
  const card = el('div', 'bc vs');
  if (/ATT \/ 100$/.test(label)) card.classList.add('vol');
  if (v == null) card.classList.add('none');
  if (BAR_HINT[k]) card.title = BAR_HINT[k];
  card.style.setProperty('--bc-band', barBand(p));
  /* the chart: the league as it is, and him at the part's figure */
  if (v != null) statBind(card, k, label, mine, pool, r => (r.id === mine.id ? v : r[k]));

  const top = el('div', 'bc-top');
  top.appendChild(el('div', 'bc-l', label));
  const val = el('div', 'bc-v', v == null ? '—' : fmt(v));
  if (p != null) { const bp = el('div', 'bp', ord(p)); bp.setAttribute('data-i18n-ctx', 'pctl'); val.appendChild(bp); }
  top.appendChild(val);
  card.appendChild(top);

  const track = el('div', 'bc-track');
  const fill = el('i');
  fill.style.width = (p == null ? 0 : Math.max(2, p)) + '%';
  fill.style.background = barBand(p);
  track.appendChild(fill);
  if (pa != null) {
    const tick = el('b', 'bc-tick');
    tick.style.left = pa + '%';
    tick.title = 'all his minutes: ' + fmt(a);
    track.appendChild(tick);
  }
  card.appendChild(track);

  const row = el('div', 'bc-d');
  if (!can) { row.classList.add('level'); row.appendChild(el('span', null, 'not split by who he played against')); }
  else if (v == null) {
    row.classList.add('level');
    row.appendChild(el('span', null, unit === 'start' ? 'not enough minutes against the starters' : 'not enough minutes against the bench'));
  } else if (a != null) {
    const d = Number(v) - Number(a), shown = Number(Math.abs(d).toFixed(dp));
    if (shown === 0) { row.classList.add('level'); row.appendChild(el('b', null, 'level with all his minutes')); }
    else {
      const up = d > 0;
      row.classList.add(up ? 'above' : 'below', (low ? !up : up) ? 'good' : 'bad');
      row.appendChild(el('b', null, (up ? '+' : '-') + shown.toFixed(dp) + ' vs all his minutes'));
    }
    row.appendChild(el('span', null, 'all minutes ' + fmt(a)));
  }
  card.appendChild(row);
  return card;
}
/* a segmented switch: one pressed button of a few */
function segs(name, opts, cur, pick) {
  const g = el('div', 'segs');
  g.setAttribute('role', 'group');
  g.setAttribute('aria-label', name);
  opts.forEach(([v, label]) => {
    const b = el('button', 'ep-btn' + (v === cur ? ' pri' : ''), label);
    b.type = 'button';
    b.setAttribute('aria-pressed', v === cur ? 'true' : 'false');
    b.addEventListener('click', () => { if (v !== cur) pick(v); });
    g.appendChild(b);
  });
  return g;
}

/* ---- POSITION BREAKDOWN (2026-10-02, in place of the estimated-position chip) ----
   THE SHARE OF HIS MINUTES AT EACH POSITION, point guard to centre, in the games of the season and competition shown: each
   five he was in is ranked point guard to centre (t/depth.js floorPos, the club page's depth chart's own ranking) and its
   minutes go to his place in it. Each game is read from its position file (snapshots/pos/<game>.json, docs/position-
   files.md) where it has one, or else from its lineups -- the ones "on the floor with" has already read where it has, the
   rest read here -- each five ranked by its players' positions on the season line, their listed positions and heights. */
let POS_RUN = 0;
const CLUB_STINTS = new Map();          // game id -> its lineup stints (both sides), as "on the floor with" read them
async function paintPosBreakdown(rows, field) {
  const host = $('#idpos');
  const X = window.EpinoiaDepth, D = window.EpinoiaData;
  const run = ++POS_RUN;
  if (!host) return;
  const mine = (rows || []).filter(r => r && r.game_id && r.player_uuid && (r.team_idx === 0 || r.team_idx === 1) &&
    (!SCOPE_IDS || !SCOPE_IDS.length || SCOPE_IDS.indexOf((r.games || {}).competition_id) >= 0));
  if (!X || !X.floorPos || !D || !mine.length) { host.hidden = true; host.textContent = ''; rpGive('pos', null); return; }
  const sideOf = {}, who = {};
  mine.forEach(r => { sideOf[r.game_id] = r.team_idx; who[r.game_id] = r.player_uuid; });
  const ids = Object.keys(sideOf);
  const sec = [0, 0, 0, 0, 0];
  const games = new Set();
  /* the newest three games' files first: none there (a members-only league, or before the files were written), and
     no more are asked for -- the club page's rule (team.js depthShares) */
  let files = new Map();
  try {
    if (D.posFiles) {
      const when = id => String(((mine.find(r => r.game_id === id) || {}).games || {}).tipoff_at || '');
      const order = ids.slice().sort((a, b) => when(b).localeCompare(when(a)));
      files = await D.posFiles(order.slice(0, 3));
      if (order.length > 3 && [...files.values()].some(Boolean)) (await D.posFiles(order.slice(3))).forEach((f, id) => files.set(id, f));
    }
  } catch (_) { /* the lineups, below */ }
  const rest = [];
  ids.forEach(id => {
    const f = files.get(id);
    if (!f || !(X.posFileOk ? X.posFileOk(f, id) : true)) { rest.push(id); return; }
    const a = (f.t[sideOf[id]] || {})[who[id]];
    if (!Array.isArray(a)) return;
    let here = 0;
    for (let k = 0; k < 5; k++) { const x = +a[k + 1] || 0; sec[k] += x; here += x; }
    if (here > 0) games.add(id);
  });
  if (rest.length) {
    try {
      const need = rest.filter(id => !CLUB_STINTS.has(id));
      if (need.length) {
        const got = await D.stints(need);
        need.forEach(id => CLUB_STINTS.set(id, []));
        got.forEach(st => { if (CLUB_STINTS.has(st.game_id)) CLUB_STINTS.get(st.game_id).push(st); });
      }
      const st = rest.flatMap(id => (CLUB_STINTS.get(id) || []).map(x => Object.assign({}, x, { dur: x.dur != null ? x.dur : (x.stats || {}).dur })));
      /* each player's place: his season line's position, his listing and his height (depth.js positionOf) */
      const people = [...new Set(st.filter(x => x.team_idx === sideOf[x.game_id]).flatMap(x => x.player_ids || []))].filter(Boolean);
      const meta = people.length && D.playerMeta ? await D.playerMeta(people).catch(() => ({})) : {};
      const tall = new Map();
      try {
        for (let i = 0; i < people.length; i += 60) {
          (await api('players?id=in.(' + people.slice(i, i + 60).join(',') + ')&select=id,height_cm')).forEach(p => tall.set(p.id, p.height_cm));
        }
      } catch (_) { /* positions from the season line and the listings */ }
      const line = new Map((field || []).map(r => [r.id, r]));
      const fp = X.floorPos(st, sideOf, id => X.positionOf({ position: (meta[id] || {}).position || '', height: tall.get(id) }, line.get(id) || null));
      ((fp && fp.players) || []).forEach(p => {
        if (!rest.some(gid => who[gid] === p.id)) return;
        /* his minutes in those games only: a linked profile's id is one game's, and floorPos summed the games together */
        p.min.forEach((m, k) => { sec[k] += m * 60; });
      });
      rest.forEach(gid => { if ((CLUB_STINTS.get(gid) || []).some(x => (x.player_ids || []).indexOf(who[gid]) >= 0)) games.add(gid); });
    } catch (e) { console.warn('[positions]', e); }
  }
  if (run !== POS_RUN) return;
  const total = sec.reduce((a, b) => a + b, 0);
  host.textContent = '';
  if (!(total > 0)) { host.hidden = true; rpGive('pos', null); return; }
  const SL = X.SLOTS || [['PG', 'point guard'], ['SG', 'shooting guard'], ['SF', 'small forward'], ['PF', 'power forward'], ['C', 'centre']];
  const pct = sec.map(x => 100 * x / total);
  rpGive('pos', { pct, games: games.size, minutes: total / 60 });
  const top = pct.indexOf(Math.max(...pct));
  const head = el('div', 'ip-h');
  head.append(el('span', 'ip-l', 'position breakdown'),
              el('span', 'ip-n', games.size + (games.size === 1 ? ' game · ' : ' games · ') + Math.round(total / 60) + ' min'));
  /* A HALF COURT, AS THE SHORTLIST AND THE MODERN BOX SCORE DRAW ONE (2026-10-02): the five spots of the modern box score
     (game/modern.js SLOTS, fractions of boxscore.js's court, the ring at the top), each a disc coloured by the share of his
     minutes there, the way Football Manager colours a player's positions -- green where he lives, through yellow and
     orange to an empty ring where he never plays -- his main position the largest, ringed */
  const SPOTS = [[0.50, 0.84], [0.19, 0.62], [0.81, 0.62], [0.29, 0.31], [0.71, 0.22]];
  const band = v => (v < 0.5 ? 0 : v < 10 ? 1 : v < 25 ? 2 : v < 50 ? 3 : 4);
  const B = window.EpinoiaBox;
  const court = el('div', 'ip-court');
  court.setAttribute('role', 'img');
  court.setAttribute('aria-label', 'minutes at each position: ' + SL.map((s2, k) => s2[1] + ' ' + Math.round(pct[k]) + '%').join(', '));
  if (B && B.courtSVG) court.innerHTML = B.courtSVG(null, { plain: true });
  const spots = el('div', 'ip-spots');
  SL.forEach((s2, k) => {
    const sp = el('span', 'ip-spot b' + band(pct[k]) + (k === top ? ' top' : ''));
    sp.style.left = (SPOTS[k][0] * 100).toFixed(1) + '%';
    sp.style.top = (SPOTS[k][1] * 100).toFixed(1) + '%';
    sp.title = s2[1] + ': ' + Math.round(pct[k]) + '% of his minutes';
    sp.append(el('b', null, s2[0]), el('i', null, Math.round(pct[k]) + '%'));
    spots.appendChild(sp);
  });
  court.appendChild(spots);
  const key = el('div', 'ip-key');
  [['b4', 'over half'], ['b3', '25\u201350%'], ['b2', '10\u201325%'], ['b1', 'under 10%'], ['b0', 'never']].forEach(([c, t]) => {
    const k = el('span', 'ip-kk');
    k.append(el('i', c), document.createTextNode(t));
    key.appendChild(k);
  });
  host.append(head, court, key);
  host.hidden = false;
}

/* 3PT CONSISTENCY (consistency.js): worked out here, for this player alone, from his game log once it has been read -
   never for the league, which is the saving. The log carries every competition he has played in, so it is cut to the ones
   the bars are showing (SCOPE_IDS). Redrawn when the log arrives, and when the scope changes. */
let LOG_ROWS = null, SCOPE_IDS = null, LAST_BARS = null;
function consistencyCard() {
  const K = window.EpinoiaConsistency, SE = window.EpinoiaSeason;
  const card = el('div', 'bc calc');
  card.appendChild(el('div', 'bc-l', '3PT CONSISTENCY'));
  card.title = 'How steady a three-point shooter he is over the season: his accuracy and how often he shoots are worked out again after ' +
    'every game, and the score is how little those running figures moved from where the season ended (100 = never). It measures steadiness, not quality.';
  if (!K) return null;
  if (!LOG_ROWS) { card.appendChild(el('div', 'bc-v', '\u2026')); card.appendChild(el('div', 'bc-d', 'reading his games')); return card; }
  const r = K.fromLog(LOG_ROWS, SCOPE_IDS, SE && SE.POSS);
  if (!r.ok) {
    card.classList.add('none');
    card.appendChild(el('div', 'bc-v', '\u2014'));
    card.appendChild(el('div', 'bc-d', r.why));
    return card;
  }
  card.style.setProperty('--bc-band', barBand(r.score));
  card.textContent = '';
  const v = el('div', 'bc-v', String(r.score)); v.appendChild(el('div', 'bp', r.label));
  const head = el('div', 'bc-top'); head.append(el('div', 'bc-l', '3PT CONSISTENCY'), v);
  card.appendChild(head);
  const track = el('div', 'bc-track'), fill = el('i');
  fill.style.width = Math.max(2, r.score) + '%'; fill.style.background = barBand(r.score);
  track.appendChild(fill); card.appendChild(track);
  /* his running 3P% after each game, against where the season ended */
  const pts = r.curve.map((c, i) => [i, c]).filter(p => p[1] != null);
  if (pts.length > 1) {
    const lo = Math.min(...pts.map(p => p[1]), r.pct), hi = Math.max(...pts.map(p => p[1]), r.pct), span = Math.max(hi - lo, 4);
    const X = i => (2 + 96 * i / (r.curve.length - 1)).toFixed(1), Y = c => (24 - 20 * (c - lo) / span).toFixed(1);
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 28'); svg.setAttribute('class', 'bc-spark'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'his season three-point percentage after each game');
    const base = document.createElementNS(NS, 'line');
    [['x1', 2], ['x2', 98], ['y1', Y(r.pct)], ['y2', Y(r.pct)]].forEach(([k, val]) => base.setAttribute(k, val));
    base.setAttribute('class', 'bc-spark-base');
    const line = document.createElementNS(NS, 'polyline');
    line.setAttribute('points', pts.map(p => X(p[0]) + ',' + Y(p[1])).join(' ')); line.setAttribute('class', 'bc-spark-line');
    svg.append(base, line); card.appendChild(svg);
  }
  const d = el('div', 'bc-d level');
  d.appendChild(el('span', null, r.games + ' games \u00b7 ' + r.att + ' 3PA \u00b7 ' + r.pct.toFixed(1) + '%' + (r.vol != null ? ' \u00b7 ' + r.vol.toFixed(1) + ' / 100' : '')));
  card.appendChild(d);
  return card;
}

function paintBars(mine, field) {
  LAST_BARS = { mine, field };
  rpGive('bars', { mine, field });
  if (REPORT && REPORT.refresh) REPORT.refresh();
  /* the '?' in the section heading (statpop.js): the explainer for every main statistic below */
  try {
    const sh = $('#bars') && $('#bars').closest('.sec') && $('#bars').closest('.sec').querySelector('.sec-h');
    if (window.EpinoiaStatPop && sh) window.EpinoiaStatPop.helpButton(sh, 'player');
  } catch (_) { /* the help is a convenience */ }
  const host = $('#bars'); host.textContent = '';
  if (!mine || field.length < 3) {
    host.appendChild(el('div', 'empty',
      'Percentiles appear once enough of the competition has played.'));
    return;
  }
  const SE = window.EpinoiaSeason, C = window.EpinoiaCards, VU = window.EpinoiaVsUnits;
  /* the per-75 box score (simple view) on every line, so its percentiles and the popup's chart read it like any other key */
  if (VU) field.forEach(VU.per75);
  /* PREMIUM BARS ARE LEFT OUT, not drawn empty: an empty track reads as a bottom percentile.
     The catalogue says which keys they are (today the assisted shares, from the events
     splits); the group they came from says so in one line instead. */
  const CAT = pLocked('events') && window.EpinoiaAccess ? window.EpinoiaAccess.CATALOGUE : null;
  const premiumBar = k => !!CAT && (typeof CAT.barKeys === 'function' ? !!CAT.barKeys(k)
    : Array.isArray(CAT.barKeys) && CAT.barKeys.indexOf(k) !== -1);
  /* bigsOnly blocks (rim protection) are drawn only for an estimated centre or forward */
  const bigGroup = SE.positionGroups ? SE.positionGroups(field).get(mine.id) : null;
  const isBig = bigGroup === 'C' || bigGroup === 'F';
  const sections = (barsView === 'simple' ? SIMPLE_SECTIONS : BAR_SECTIONS).map(s => ({
    key: s.key, title: s.title,
    held: s.blocks.some(b => b.rows.some(r => premiumBar(r[0]))),
    blocks: s.blocks.filter(b => !b.bigsOnly || isBig)
      .map(b => Object.assign({}, b, { rows: b.rows.filter(r => !premiumBar(r[0])) })).filter(b => b.rows.length)
  }));
  const keys = sections.flatMap(s => s.blocks.flatMap(b => b.rows.map(r => r[0])));
  const posMap = barsByPos && SE.positionGroups ? SE.positionGroups(field) : null;
  const group = posMap ? (posMap.get(mine.id) || null) : null;
  const ranks = SE.percentiles(field, keys, BAR_LOW, group ? (r => posMap.get(r.id) || null) : null);
  const pool = group ? field.filter(r => posMap.get(r.id) === group) : field;
  $('#barNote').textContent = 'vs ' + pool.length + ' ' +
    (group ? (SE.positionLabel ? SE.positionLabel(group) : 'players') : 'players');

  /* AGAINST THE STARTERS OR THE BENCH: worked out on the first ask (vsLines), the bars drawn as ALL until it is */
  const unit = barsVs !== 'all' && !pLocked('splits') && VU ? barsVs : null;
  const V = unit ? vsLines(mine) : null;
  const vsOn = V && V.state === 'ready' ? V : null;

  /* the switches sit above the bars, where the note they change is */
  const sw = el('div', 'barswitch');
  sw.appendChild(segs('view', [['scout', 'scouting view'], ['simple', 'simple view']], barsView, v => {
    barsView = v; keep('epinoia_bars_view', v); paintBars(mine, field);
  }));
  sw.appendChild(segs('against', [['all', 'all'], ['start', 'vs. starters'], ['bench', 'vs. bench']], barsVs, v => {
    barsVs = v; keep('epinoia_bars_vs', v); paintBars(mine, field);
  }));
  const btn = el('button', 'ep-btn bsw-pos' + (barsByPos ? ' pri' : ''), 'adjust for position');
  btn.type = 'button';
  btn.title = group || !barsByPos
    ? 'rank him against players of his own position rather than the whole competition'
    : 'his position could not be worked out, so the bars stay against everybody';
  btn.addEventListener('click', () => {
    barsByPos = !barsByPos;
    try { localStorage.setItem('epinoia_bars_pos', barsByPos ? '1' : '0'); } catch (_) { /* fine */ }
    paintBars(mine, field);
  });
  sw.appendChild(btn);
  if (barsByPos && !group) sw.appendChild(el('span', 'barswitch-note', 'no position for this player'));
  /* FIND SIMILAR PLAYERS, left of expand all: four games or fifty minutes in the line shown (similar.js eligible), and a
     competition to look him up in. Pressed, the bars slide off to the left and the matches come in from the right. */
  const SU = window.EpinoiaSimilarUI, SS = window.EpinoiaSimilar;
  const simOk = !!(SU && SS && SIM_CTX && SS.eligible(mine));
  const sb = el('button', 'ep-btn sim-btn', 'find similar players');
  sb.type = 'button';
  if (SS && SU) {
    if (!simOk) {
      sb.disabled = true;
      sb.title = 'Similar players need four games or fifty minutes in the season shown';
    } else {
      sb.title = simSigninFirst() ? 'Sign in to find the players across every competition whose style and rates are closest to this one'
        : 'The players across every competition whose style and rates are closest to this one';
      /* nothing is fetched for a reader who has to sign in first */
      const warm = () => { if (!simSigninFirst()) SU.prefetch(SIM_CTX.cid, SIM_CTX.pid); };
      sb.addEventListener('pointerenter', warm); sb.addEventListener('focus', warm);
    }
  }
  const all = el('span', 'xc-all');
  const open = el('button', 'ep-btn', 'expand all'), shut = el('button', 'ep-btn', 'collapse all');
  open.type = shut.type = 'button';
  all.append(open, shut);
  if (SS && SU) sw.appendChild(sb);
  /* COMPARE PLAYER, beside it: this line against any player of any league, in the statistics page's compare chart.
     Pressed, the dropdowns open under the switches (p/compare-ui.js) */
  const PC = window.EpinoiaProfileCompare, cmpCtx = CMP_CTX;
  const cb = PC && window.EpinoiaCompare && cmpCtx && cmpCtx.mine === mine ? el('button', 'ep-btn cmp-btn', 'compare player') : null;
  if (cb) {
    cb.type = 'button';
    cb.title = 'Set this season against any player of any league, stat by stat';
    sw.appendChild(cb);
  }
  sw.appendChild(all);
  host.appendChild(sw);
  if (cb) {
    const cmpHost = el('div', 'pcmp-host');
    host.appendChild(cmpHost);
    const show = (on, focus) => {
      cmpOpen = on;
      cb.classList.toggle('on', on);
      cb.setAttribute('aria-expanded', on ? 'true' : 'false');
      cmpHost.textContent = '';
      /* byPos: the chart opens adjusted for position where the bars are */
      if (on) PC.open(cmpHost, Object.assign({}, cmpCtx, { focus, byPos: barsByPos, onClose: () => { show(false); cb.focus(); } }));
    };
    cb.addEventListener('click', () => show(!cmpOpen, true));
    show(cmpOpen, false);
  }
  /* the stage holds the bars and the matches on one spot, so one can slide out as the other slides in */
  const stage = el('div', 'bars-stage');
  host.appendChild(stage);
  const vsn = barsVs !== 'all' ? vsNote(V, barsVs) : null;
  if (vsn) stage.appendChild(vsn);

  const wrap = el('div', 'bars');
  /* against the starters or the bench, each bar is that part (the consistency card is the whole season's, so it waits) */
  const cardsOf = (rows, extra) => {
    const g = el('div', 'bcs');
    rows.forEach(([k, label]) => g.appendChild(vsOn ? vsCard(k, label, mine, pool, vsOn, unit) : barCard(k, label, mine, ranks, pool)));
    if (extra && !vsOn) { const c = extra(); if (c) g.appendChild(c); }
    return g;
  };
  /* what a section says about itself when it is folded: the average percentile of its bars */
  const pctOf = k => vsOn
    ? VU.placeIn(VU.sortedOf(pool, k), VU.splitable(k) && vsOn.lines[unit] ? vsOn.lines[unit][k] : null, BAR_LOW.indexOf(k) !== -1)
    : (ranks.get(k) || new Map()).get(mine.id);
  const summary = rows => {
    const ps = rows.map(([k]) => pctOf(k)).filter(p => p != null);
    return ps.length ? 'avg ' + ord(ps.reduce((a, b) => a + b, 0) / ps.length) : null;
  };
  sections.forEach(s => {
    const body = () => {
      const b = el('div');
      s.blocks.forEach(blk => {
        if (blk.fold) {
          /* a fold of its own inside the card (impact's four factors) */
          b.appendChild(C.collapsible({ key: 'p_' + s.key + '_' + blk.title, title: blk.title, note: blk.note, sub: true, open: false,
            summary: summary(blk.rows), body: () => cardsOf(blk.rows) }));
        } else if (blk.title) {
          /* a group inside the card, not folded: the distances of the shooting card, impact's on/off and BPM */
          const g = el('div', 'bsub');
          g.appendChild(el('div', 'bsub-h', blk.title));
          g.appendChild(cardsOf(blk.rows, blk.consistency ? consistencyCard : null));
          b.appendChild(g);
        } else b.appendChild(cardsOf(blk.rows));
      });
      if (s.held) {
        const line = el('div', 'barteaser');
        line.innerHTML = accessTeaser({ compact: true, title: 'Assisted and self-created scoring',
          lines: ['How much of the scoring came off a pass, by distance — part of Epinoia analytics.'] });
        b.appendChild(line);
      }
      return b;
    };
    wrap.appendChild(C.collapsible({ key: 'p_' + s.key, title: s.title,
      summary: summary(s.blocks.flatMap(b => b.rows)), body }));
  });
  stage.appendChild(wrap);
  open.addEventListener('click', () => { if (simOpen && SIM_CTL) SIM_CTL.setAll(true); else C.setAll(wrap, true); });
  shut.addEventListener('click', () => { if (simOpen && SIM_CTL) SIM_CTL.setAll(false); else C.setAll(wrap, false); });

  /* ---- the swap ---- */
  const showSim = on => {
    simOpen = on;
    sw.classList.toggle('sim-on', on); sb.classList.toggle('on', on);
    sb.textContent = on ? '\u2190 league percentile' : 'find similar players';
  };
  /* once the slide is over, whatever left takes no room (a transition that never fires is not waited for) */
  const afterSlide = (node, fn) => {
    let done = false;
    const go = () => { if (!done) { done = true; fn(); } };
    node.addEventListener('transitionend', go, { once: true });
    setTimeout(go, 560);
  };
  const bars = [vsn, wrap].filter(Boolean);
  if (simOpen && SIM_CTL && simOk) {
    /* drawn again while the matches are showing: as they were, no slide */
    stage.classList.add('sim-on');
    stage.appendChild(SIM_CTL.node);
    SIM_CTL.node.classList.remove('gone');
    bars.forEach(n => n.classList.add('gone'));
    showSim(true);
  } else simOpen = false;
  sb.addEventListener('click', async () => {
    if (sb.disabled) return;
    if (simOpen) {
      bars.forEach(n => n.classList.remove('gone'));
      void stage.offsetWidth;
      showSim(false); stage.classList.remove('sim-on');
      const node = SIM_CTL && SIM_CTL.node;
      if (node) afterSlide(node, () => { if (!simOpen) node.classList.add('gone'); });
      return;
    }
    sb.disabled = true; sb.textContent = 'finding\u2026';
    let ctl = null;
    try { ctl = simSigninFirst() ? simSigninPanel() : await simPanel(); } catch (e) { console.warn('[similar]', e); }
    sb.disabled = false;
    if (!stage.isConnected) return;        // drawn again while the file was on its way: that draw has its own button
    if (!ctl) { sb.textContent = 'find similar players'; return; }
    SIM_CTL = ctl;
    if (ctl.node.parentNode !== stage) stage.appendChild(ctl.node);
    ctl.node.classList.remove('gone');
    void stage.offsetWidth;                // the panel is in place, off to the right, before it is let in
    showSim(true); stage.classList.add('sim-on');
    afterSlide(wrap, () => { if (simOpen) bars.forEach(n => n.classList.add('gone')); });
  });
}

/* SIGNED IN FIRST. Similar players are for readers with an EPINOIA account (any account: no membership is asked for).
   A signed-out reader is shown the site's sign-in card where the matches would be, and nothing is fetched for them
   (access.js signinFirst: true only in a browser, with no session and no refresh token to trade for one). */
function simSigninFirst() {
  const A = window.EpinoiaAccess;
  return !(A && typeof A.signinFirst === 'function') || !!A.signinFirst();
}
function simSigninPanel() {
  const A = window.EpinoiaAccess;
  const node = el('div', 'sim');
  const gate = el('div', 'sim-gate');
  gate.innerHTML = A && typeof A.signinHTML === 'function'
    ? A.signinHTML({ what: 'Similar players', plural: true,
        lines: ['The players across every competition whose style and rates are closest to this one, and what they have in common.'] })
    : '<a class="ep-btn pri" href="../signin/?next=' + encodeURIComponent(location.pathname + location.search) + '">Sign in</a>';
  node.appendChild(gate);
  return { node, setAll() {}, key: null };
}

/* THE MATCHES' PANEL for the line on show: drawn from the player's file once, and kept while the scope stays (a redraw of the bars
   moves it, it does not ask again). A line with no file yet (a game since the last build) gets a plain sentence. */
async function simPanel() {
  const X = SIM_CTX, UI = window.EpinoiaSimilarUI;
  if (!X || !UI) return null;
  const locked = pLocked('events');
  const key = X.cid + '|' + X.pid + '|' + (locked ? 1 : 0);
  if (SIM_CTL && SIM_CTL.key === key) return SIM_CTL;
  const file = await UI.load(X.cid, X.pid);
  if (!file) {
    const node = el('div', 'sim');
    node.appendChild(el('div', 'empty', 'No similar players for this season yet. They are worked out once a day from every competition, so a player with a new line shows up the next day.'));
    return { node, setAll() {}, key: null };
  }
  const ctl = UI.render({ file, name: X.name, locked, basis: X.basis,
    teaser: locked ? accessTeaser({ compact: true, title: 'Assisted and half-court / transition shares',
      lines: ['How much of the scoring came off a pass, and how much of it came in transition, are part of Epinoia analytics.'] }) : '' });
  ctl.key = key;
  return ctl;
}


/* THE OTHER PROFILES THAT ARE THIS PERSON (migration 0178, linkswitch.js): asked for at boot so the career can
   wait for it; null when he is linked to nothing, or the database has not had 0178 yet. */
let LINKED_P = Promise.resolve(null);

/* ---- CAREER STATS (2026-10-02) ----
   EVERY SEASON AND EVERY COMPETITION HE HAS PLAYED, under this profile and every profile linked to it (0178), one row
   each and newest first: a season with two competitions is two rows (Keenan Evans's SLB row and EuroCup row), and the
   COMP column says which (fulltable.js compColumn: locked beside the club, GP and MPG in every preset). The club is the
   one he played that competition for, not today's. Each row is the competition's own season line (D.season, the leaders
   board's aggregation), so every column means what it means everywhere else.
   THE ROWS ARE THE PAGE'S SEASON AND COMPETITION: pressing a season shows it on this profile -- the hero, the tiles, the
   bars, the events and the game log -- as the chips under the hero do, and the row shown is marked. The seasons and
   competitions are the chips' own (playerScopes). It was cut at the newest eight; now every one is read, three at a
   time, up to a cap no career reaches. */
const CAREER_CAP = 60;
let CAREER = null;               // { rows, byHref, hooks } -- for marking the row shown and pressing a row
async function paintCareer(pl, team, scopes, hooks) {
  const D = window.EpinoiaData;
  const host = $('#seasons');
  host.textContent = '';
  const items = [];
  ((scopes && scopes.seasons) || []).forEach(sn => sn.comps.forEach(c => items.push({ sn, c })));
  if (!items.length) {
    $('#seasonNote').textContent = '';
    host.appendChild(el('div', 'empty', 'No finalised games yet — a season line appears once one is played.'));
    return;
  }
  const shown = items.slice(0, CAREER_CAP);
  /* the clubs he played each competition for: names, colours and crests */
  const clubIds = [...new Set(shown.flatMap(x => x.c.teams || []))];
  const clubs = new Map();
  try {
    if (clubIds.length) (await D.all(`teams?id=in.(${clubIds.join(',')})&select=id,name,short_name,colour,logo_path`)).forEach(t => clubs.set(t.id, t));
  } catch (e) { console.warn('[career clubs]', e); }
  const rows = new Array(shown.length).fill(null);
  let next = 0;
  const work = async () => {
    while (next < shown.length) {
      const i = next++, { sn, c } = shown[i];
      try {
        const S = await D.season(c.id, { rows: false, trim: true });
        const row = S.players.find(r => r.id === c.pid) || S.players.find(r => ((scopes && scopes.ids) || []).indexOf(r.id) >= 0);
        if (!row) continue;
        const cl = (c.teams || []).map(id => clubs.get(id)).filter(Boolean);
        const top = cl[0] || null;                    // the club he played most of its minutes for
        const short = c.short || c.name || '';
        rows[i] = Object.assign({}, row, {
          /* the name column carries the season: every row is the same person */
          name: sn.label,
          teamName: cl.length ? cl.map(t => t.short_name || t.name).join(' / ') : (row.teamName || ''),
          teamShort: top ? (top.short_name || '') : (row.teamShort || ''), teamFull: top ? (top.name || '') : (row.teamFull || ''),
          colour: top ? (top.colour || null) : (row.colour || null), teamLogo: top ? (top.logo_path || null) : (row.teamLogo || null),
          compLabel: short, _comp: c.name || '', _league: c.league || '',
          _club: cl.length ? cl.map(t => t.name || t.short_name).join(' / ') : (row.teamFull || row.teamName || ''),
          _label: [sn.label, short].filter(Boolean).join(' · '),
          _season: sn.label, _cid: c.id, _href: scopeHref(sn, c.id)
        });
      } catch (e) { console.warn('[career season]', c.id, e); }
    }
  };
  await Promise.all([work(), work(), work()]);
  const list = rows.filter(Boolean);
  if (!list.length) {
    $('#seasonNote').textContent = '';
    host.appendChild(el('div', 'empty', 'No finalised games yet.'));
    return;
  }
  const nS = new Set(list.map(r => r._season)).size, games = list.reduce((n, r) => n + (r.gp || 0), 0);
  $('#seasonNote').textContent = nS + (nS === 1 ? ' season · ' : ' seasons · ') +
    list.length + (list.length === 1 ? ' competition · ' : ' competitions · ') + games + (games === 1 ? ' game' : ' games') +
    (items.length > shown.length ? ' · the newest ' + CAREER_CAP : '');
  CAREER = { rows: list, byHref: new Map(list.map(r => [r._href, r])), hooks: hooks || null };
  renderCareerRows(host, list, pl);
}

function renderCareerRows(host, rows, pl) {
  window.EpinoiaTable.render({
    host: '#seasons', kind: 'player', sortKey: 'rank', sortDir: 1, showMinGames: false, heat: false,
    filename: (pl.slug || 'player') + '-career',
    nameLabel: 'SEASON', compColumn: true,
    /* a season is a link to it on this page (?s= and ?c=): a plain press redraws in place (below) */
    playerHref: r => r._href || null,
    onDraw: markCareer,
    /* the table drops the premium columns itself when this league's analytics are locked */
    leagueId: ACCESS_LEAGUE.id, leagueSlug: ACCESS_LEAGUE.slug,
    rows
  });
  paintSeasonShot(rows);
}
/* the row (or, for every competition of a season, the rows) the profile is showing */
function markCareer() {
  if (!CAREER) return;
  const cur = CAREER.hooks && CAREER.hooks.current ? CAREER.hooks.current() : null;
  document.querySelectorAll('#seasons table.ft tbody tr').forEach(tr => {
    const a = tr.querySelector('.ft-name a');
    const r = a ? CAREER.byHref.get(a.getAttribute('href')) : null;
    const on = !!(cur && r && r._season === cur.label && (cur.kind === 'all' || r._cid === cur.kind));
    tr.classList.toggle('cur', on);
    if (a) { if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); }
  });
}
document.addEventListener('click', e => {
  const a = e.target && e.target.closest && e.target.closest('#seasons table.ft .ft-name a');
  if (!a || !CAREER || !CAREER.hooks || !CAREER.hooks.pick) return;
  /* a modified click is the reader asking for a new tab */
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
  const r = CAREER.byHref.get(a.getAttribute('href'));
  if (!r) return;
  e.preventDefault();
  CAREER.hooks.pick(r._season, r._cid);
});

/* ------------------------------------------------------ the season, as a picture ---
   THE SAME ROWS, FRAMED TO BE CAPTURED. The full table is for reading; this is the per-game
   line a scouting report prints: one averages grid, the club he played for and fourteen
   numbers, and nothing else inside the frame. Every figure is the table's own season line
   (EpinoiaData.season), only fewer of them. A player with more than one season or
   competition chooses which with the buttons above the frame; the choice of view is
   remembered for the next profile, as the bars' is. */
const pc1 = v => (v == null ? '—' : Number(v).toFixed(1) + '%');
const SHOT_COLS = [
  ['G',    r => (r.gp == null ? '—' : String(r.gp))],
  ['MIN',  r => n1(r.mpg)],
  ['PTS',  r => n1(r.ppg)],
  ['2FGP', r => pc1(r.p2_pct)],
  ['3FGP', r => pc1(r.p3_pct)],
  ['FT',   r => pc1(r.ft_pct)],
  ['RO',   r => n1(r.orpg)],
  ['RD',   r => n1(r.drpg)],
  ['RT',   r => n1(r.rpg)],
  ['AS',   r => n1(r.apg)],
  ['PF',   r => n1(r.pfpg)],
  ['BS',   r => n1(r.bpg)],
  ['ST',   r => n1(r.spg)],
  ['TO',   r => n1(r.topg)]
];
let seasonView = 'table';
try { if (localStorage.getItem('epinoia_season_view') === 'screenshot') seasonView = 'screenshot'; } catch (_) { /* default */ }
let shotRows = [], shotAt = 0;

function paintSeasonShot(rows) {
  shotRows = rows || [];
  if (shotAt >= shotRows.length) shotAt = 0;
  const host = $('#seasonShot');
  if (!host) return;
  host.textContent = '';
  if (shotRows.length > 1) {
    const pick = el('div', 'shotpick');
    shotRows.forEach((r, i) => {
      const b = el('button', 'ep-btn' + (i === shotAt ? ' pri' : ''), r._label || r.name || '—');
      b.type = 'button';
      b.setAttribute('translate', 'no');           // a season's and a competition's names
      b.addEventListener('click', () => { shotAt = i; paintSeasonShot(shotRows); });
      pick.appendChild(b);
    });
    host.appendChild(pick);
  }
  const r = shotRows[shotAt];
  if (r) {
    const card = el('div', 'shotcard');
    card.appendChild(el('div', 'shot-h', 'Averages'));
    const t = el('table', 'shot');
    const thead = el('thead'), hr = el('tr');
    hr.appendChild(el('th', null, 'TEAM'));
    SHOT_COLS.forEach(([h]) => hr.appendChild(el('th', null, h)));
    thead.appendChild(hr); t.appendChild(thead);
    const tb = el('tbody'), tr = el('tr');
    const club = el('td', 'shot-team', r._club || r.teamName || '—');
    club.setAttribute('translate', 'no');          // a club's name is never translated
    tr.appendChild(club);
    SHOT_COLS.forEach(([, f]) => tr.appendChild(el('td', null, f(r))));
    tb.appendChild(tr); t.appendChild(tb);
    const wrap = el('div', 'shot-wrap');
    wrap.appendChild(t); card.appendChild(wrap); host.appendChild(card);
  }
  const bar = $('#seasonView');
  if (bar) bar.hidden = !shotRows.length;
  applySeasonView();
}

function applySeasonView() {
  const shot = seasonView === 'screenshot' && shotRows.length > 0;
  $('#seasons').hidden = shot;
  $('#seasonShot').hidden = !shot;
  document.querySelectorAll('#seasonView button[data-view]').forEach(b =>
    b.classList.toggle('pri', b.dataset.view === (shot ? 'screenshot' : 'table')));
}

document.addEventListener('click', e => {
  const b = e.target && e.target.closest && e.target.closest('#seasonView button[data-view]');
  if (!b) return;
  seasonView = b.dataset.view === 'screenshot' ? 'screenshot' : 'table';
  try { localStorage.setItem('epinoia_season_view', seasonView); } catch (_) { /* this page only */ }
  applySeasonView();
});

/* -------------------------------------------------------------- game log --- */
/* THE GAME LOG (p/gamelog.js): a chart of any statistic over the season, picked by pressing it, over the table of his
   games, each with its competition (comps: id -> SLB, EuroCup). A row opens the game's box score. */
function paintLog(rows, comps) {
  $('#logNote').textContent = rows.length ? rows.length + (rows.length === 1 ? ' game' : ' games') : '';
  const GL = window.EpinoiaGameLog;
  if (!GL) { $('#log').textContent = ''; return; }
  GL.render({ host: '#log', rows, comps: comps || new Map(),
              boxHref: id => '../game/?g=' + encodeURIComponent(id) + '&mode=supabase' });
}

/* Every league he has a roster entry in, read once per page however many callers ask
   (membersOnly and loadCareerAccess, below). Rosters are the shop window, so no league
   refuses this read to anybody. A failed read is remembered as failed for this page: both
   callers treat it as "no other leagues", which leaves the page as open as it was. */
let rosterLeaguesP = null;
function rosterLeagues(pl) {
  if (!rosterLeaguesP) {
    rosterLeaguesP = api(`roster_entries?player_id=eq.${pl.id}&select=teams(leagues(id))`)
      .then(rows => [...new Set(rows.map(r => ((r.teams || {}).leagues || {}).id).filter(Boolean))]);
  }
  return rosterLeaguesP;
}

/* ---------------------------------------------------------- members only ---
   A MEMBERS-ONLY LEAGUE (docs/memberships.md §2). The database already refuses this player's
   games and season rows to a viewer who is not a member, so every section below would come
   up empty and look broken; the card says why instead. Name, photo and club stay: squads and
   player names are the league's shop window.

   ONLY WHEN EVERY LEAGUE HE IS ROSTERED IN IS CLOSED TO THIS VIEWER. A player who also
   appears in an open league keeps his page, and the closed league's rows simply do not come
   back. The other leagues are only looked up once the current one has said no, so an open
   league costs nothing here. Anything that cannot be told -- a failed read, a league the
   module has no answer for -- leaves the page open, as every access check does. */
async function membersOnly(pl, lgRow) {
  const A = window.EpinoiaAccess;
  if (!A || typeof A.get !== 'function' || typeof A.canView !== 'function') return false;
  const shut = id => { const s = A.get(id); return !!(s && s.known) && !A.canView(id); };
  if (!shut(lgRow.id)) return false;
  let others = [];
  try {
    others = (await rosterLeagues(pl)).filter(id => id !== lgRow.id);
    await Promise.all(others.map(id =>
      Promise.resolve().then(() => A.load({ leagueId: id })).catch(() => null)));
  } catch (_) { return false; }
  if (!others.every(shut)) return false;
  document.body.classList.add('members-only');
  const card = $('#paywall');
  if (card && typeof A.paywallHTML === 'function') {
    card.innerHTML = A.paywallHTML({ league: lgRow });
    card.hidden = false;
  }
  return true;
}

/* THE REST OF HIS CAREER, BEFORE IT IS READ. A token rides on this page's reads only once
   access.js has loaded a members-only league the viewer may see, and boot loads one league:
   his current club's. A member looking at a player who came from another members-only
   league would have that league's season rows and games refused -- the career table and the
   game log quietly a season short. So those leagues are asked about too, before the career
   is read. Only for somebody signed in: an anonymous viewer carries no token whatever the
   answer, so for most readers this costs nothing, and an open league's answer is cached for
   the next page. Never rejects, and bounded by access.js's own four-second limit. */
async function loadCareerAccess(pl, lgRow) {
  const A = window.EpinoiaAccess;
  if (!A || typeof A.load !== 'function') return;
  try {
    /* sessionReady renews an expired token first, as load() does -- a member back at an
       old tab is still a member */
    const s = typeof A.sessionReady === 'function' ? await A.sessionReady()
      : (typeof A.session === 'function' ? A.session() : null);
    if (!s) return;
    const others = (await rosterLeagues(pl)).filter(id => !lgRow || id !== lgRow.id);
    await Promise.all(others.map(id =>
      Promise.resolve().then(() => A.load({ leagueId: id })).catch(() => null)));
  } catch (_) { /* the career as the current league's answer leaves it */ }
}

/* ------------------------------------------------------- season and competition --- */
/* THE SEASONS HE HAS PLAYED, newest first, each with the competitions he played in it and the profile he played each
   under: his season lines (player_season_stats) across every profile linked to his (linkswitch.js), named by their
   competitions. A season is its name, so 2025-26 in his league and 2025-26 in a European cup are one season of his
   career with two competitions. A profile the view has not caught up with yet falls back on his club's games.
     -> { ids: every linked profile id, seasons: [{ key, name, label, starts_on, comps: [{ id, name, kind, league, pid, gp }] }] } */
const seasonLabelOf = n => { const SB = window.EpinoiaSeasonBar; return SB && SB.label ? SB.label(n) : String(n || ''); };
async function playerScopes(pl, team) {
  const D = window.EpinoiaData, L = window.EpinoiaLinks;
  let linked = null;
  try { linked = await LINKED_P; } catch (_) { /* his own profile alone */ }
  const ids = L && L.playerIds ? L.playerIds(linked, pl.id) : [pl.id];
  let apps = [];
  try {
    apps = await D.all(`player_season_stats?player_id=${ids.length > 1 ? 'in.(' + ids.join(',') + ')' : 'eq.' + pl.id}` +
      `&select=player_id,competition_id,season_id,team_id,gp,min`);
  } catch (e) { console.warn('[scopes]', e); }
  /* a competition is his under the profile he played most of its minutes under */
  const byComp = new Map();
  apps.forEach(a => {
    if (!a.competition_id) return;
    const gp = +a.gp || 0, min = +a.min || 0;
    let cur = byComp.get(a.competition_id);
    if (!cur) { cur = { pid: a.player_id, gp: 0, min: 0, best: min, clubs: new Map() }; byComp.set(a.competition_id, cur); }
    else if (min > cur.best) { cur.pid = a.player_id; cur.best = min; }
    cur.gp += gp; cur.min += min;                    // a season at two clubs is two rows
    if (a.team_id) cur.clubs.set(a.team_id, (cur.clubs.get(a.team_id) || 0) + min);
  });
  if (!byComp.size && team && team.id) {
    try {
      const played = await D.all(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})&status=eq.final&select=competition_id`);
      [...new Set(played.map(g => g.competition_id).filter(Boolean))].forEach(id => byComp.set(id, { pid: pl.id, gp: 0, min: 0, best: 0 }));
    } catch (e) { console.warn('[scopes club]', e); }
  }
  if (!byComp.size) return { ids, seasons: [] };
  let comps = [];
  try {
    comps = await D.all(`competitions?id=in.(${[...byComp.keys()].join(',')})` +
      `&select=id,name,kind,season_id,seasons(id,name,starts_on,leagues(name,slug,initials))`);
  } catch (e) { console.warn('[scopes comps]', e); }
  const seasons = new Map();
  comps.forEach(c => {
    const sn = c.seasons || {}, label = seasonLabelOf(sn.name);
    const key = label || 'c:' + c.id;
    if (!seasons.has(key)) seasons.set(key, { key, name: sn.name || '', label: label || c.name || '', starts_on: sn.starts_on || null, comps: [] });
    const S = seasons.get(key);
    if (sn.starts_on && (!S.starts_on || sn.starts_on > S.starts_on)) S.starts_on = sn.starts_on;
    const a = byComp.get(c.id) || {};
    S.comps.push({ id: c.id, name: c.name || '', kind: c.kind || 'league', league: (sn.leagues && sn.leagues.name) || '', pid: a.pid || pl.id,
                   gp: a.gp || 0, min: a.min || 0, leagueRow: sn.leagues || null,
                   /* the clubs he played it for, the most minutes first (the career table's TEAM) */
                   teams: a.clubs ? [...a.clubs.entries()].sort((x, y) => y[1] - x[1]).map(x => x[0]) : [] });
  });
  const SB = window.EpinoiaSeasonBar;
  const newest = SB && SB.newestFirst ? SB.newestFirst
    : (a, b) => String(b.starts_on || '').localeCompare(String(a.starts_on || '')) || String(b.name).localeCompare(String(a.name));
  const list = [...seasons.values()].sort(newest);
  /* most minutes first, so a season he played under two profiles opens on the one he mostly played */
  list.forEach(sn => sn.comps.sort((a, b) => (b.min - a.min) || (b.gp - a.gp) || String(a.name).localeCompare(String(b.name))));
  /* each competition as a reader names it, within its season: SLB, SLB Cup, EuroCup (seasonbar.js compLabels) */
  list.forEach(sn => {
    const labs = SB && SB.compLabels ? SB.compLabels(sn.comps.map(c => ({ id: c.id, name: c.name, kind: c.kind, league: c.leagueRow || c.league }))) : new Map();
    sn.comps.forEach(c => { c.short = labs.get(c.id) || c.name || ''; });
  });
  return { ids, seasons: list };
}
/* ?s= is the season as a person writes it (2025/26), its name (2025-26) or its id; nothing, or nothing he played: the newest */
function pickScopeSeason(list, ref) {
  if (!list.length) return null;
  if (!ref) return list[0];
  const want = String(ref).trim();
  return list.find(s => s.label === want || s.name === want || s.key === want) ||
         list.find(s => seasonLabelOf(want) && s.label === seasonLabelOf(want)) || list[0];
}
/* every competition of the season together: where there is more than one, and one profile played them all */
const allOk = sn => !!sn && sn.comps.length > 1 && new Set(sn.comps.map(c => c.pid)).size === 1;
function scopeHref(sn, kind) {
  const u = new URL(location.href);
  u.searchParams.set('s', (sn && sn.label) || '');
  if (kind && kind !== 'all' && sn && sn.comps.length > 1) u.searchParams.set('c', kind); else u.searchParams.delete('c');
  return u.pathname + u.search + u.hash;
}
function syncScopeUrl(sn, kind) {
  if (!sn) return;
  try { history.replaceState(null, '', scopeHref(sn, kind)); } catch (_) { /* the page is still right */ }
}
/* WHICH SEASON HIS NUMBERS ARE FROM, on the hero, always: the season large, the competition beside it */
function paintScopeLabel(sn, kind) {
  const host = $('#idseason');
  if (!host) return;
  host.textContent = '';
  if (!sn) { host.hidden = true; return; }
  const comps = sn.comps || [];
  const one = kind === 'all' ? (comps.length === 1 ? comps[0] : null) : comps.find(c => c.id === kind);
  host.append(el('span', 'is-l', 'season'), el('span', 'is-v', sn.label));
  const c = one ? el('span', 'is-c', one.short || one.name || one.league || '') : el('span', 'is-c', 'all competitions');
  if (one) c.setAttribute('translate', 'no');
  if (c.textContent) host.appendChild(c);
  host.hidden = false;
}
/* EACH GAME'S BPM, as the game page works it (bpm.js game: the game-level adaptation of BPM): every line of his games, both
   sides, read lean - the numbers BPM needs out of each stats blob (aliases, since "or" and "to" are words PostgREST keeps) -
   with the clubs' own lines for the game (pace, ratings, average lead) and each game's competition's season (positions,
   offensive roles and season BPMs), twenty games to a request, so a request stays under the thousand rows the API returns.
   On each of his rows as __bpm. */
const BPM_COLS = 'game_id,team_idx,player_uuid,' + [['pts', 'pts'], ['p2m', 'p2m'], ['p2a', 'p2a'], ['p3m', 'p3m'], ['p3a', 'p3a'],
  ['fta', 'fta'], ['ftm', 'ftm'], ['oreb', 'or'], ['dreb', 'dr'], ['ast', 'ast'], ['stl', 'stl'], ['blk', 'blk'], ['tov', 'to'],
  ['pf', 'pf'], ['min', 'min']].map(([a, k]) => a + ':stats->' + k).join(',');
const CLUB_COLS = 'game_id,team_idx,pace:stats->adv->pace,ortg:stats->adv->ortg,drtg:stats->adv->drtg,avgLead:stats->adv->avgLead';
async function logBPM(rows) {
  const B = window.EpinoiaBPM, D = window.EpinoiaData;
  if (!B || !B.game || !rows.length) return;
  const gids = [...new Set(rows.map(r => r.game_id).filter(Boolean))];
  const chunks = [];
  for (let i = 0; i < gids.length; i += 20) chunks.push(gids.slice(i, i + 20));
  const byGame = new Map(), clubs = new Map();
  await Promise.all(chunks.map(async c => {
    const [list, tm] = await Promise.all([api(`player_game_stats?game_id=in.(${c.join(',')})&select=${BPM_COLS}`),
      api(`team_game_stats?game_id=in.(${c.join(',')})&select=${CLUB_COLS}`).catch(() => [])]);
    list.forEach(l => {
      if (!byGame.has(l.game_id)) byGame.set(l.game_id, []);
      byGame.get(l.game_id).push({ id: l.player_uuid, side: l.team_idx, stats: { min: l.min, pts: l.pts, p2m: l.p2m, p2a: l.p2a, p3m: l.p3m, p3a: l.p3a,
        fta: l.fta, ftm: l.ftm, or: l.oreb, dr: l.dreb, ast: l.ast, stl: l.stl, blk: l.blk, to: l.tov, pf: l.pf } });
    });
    (tm || []).forEach(t => { if (!clubs.has(t.game_id)) clubs.set(t.game_id, [null, null]); clubs.get(t.game_id)[t.team_idx === 1 ? 1 : 0] = t; });
  }));
  /* each game's competition's season, as the game page reads it (EpinoiaModernBox.loadSeason: data.js season of that competition) */
  const seasons = new Map();
  const cids = [...new Set(rows.map(r => r.games && r.games.competition_id).filter(Boolean))];
  if (D && D.season) await Promise.all(cids.map(async cid => {
    try {
      const S = await D.season(cid, { rows: false, trim: true });
      seasons.set(cid, new Map((S.players || []).map(p => [p.id, { bpm: p.bpm, min: p.min || 0, gp: p.gp || 0, bpm_pos: p.bpm_pos, bpm_role: p.bpm_role }])));
    } catch (_) { /* that game's BPM is then the box score's own estimate */ }
  }));
  const games = new Map();
  rows.forEach(r => {
    if (!games.has(r.game_id)) {
      const cl = clubs.get(r.game_id);
      games.set(r.game_id, B.game({ lines: byGame.get(r.game_id) || [], clubs: cl && cl[0] && cl[1] ? cl : null,
        season: seasons.get(r.games && r.games.competition_id) || null }));
    }
    const b = games.get(r.game_id).get(r.player_uuid);
    r.__bpm = b ? b.bpm : null;
  });
}

/* THE GAME LOG OF THE SEASON SHOWN, every linked profile's games in it, with the opponent resolved from the game row:
   the competitions of the season, so 3PT CONSISTENCY (consistencyCard) reads the season the bars are from */
async function seasonLog(ids, sn) {
  const who = ids.length > 1 ? 'in.(' + ids.join(',') + ')' : 'eq.' + ids[0];
  const comps = sn ? sn.comps.map(c => c.id) : [];
  const gl = await api(`player_game_stats?player_uuid=${who}` +
    `&select=game_id,team_idx,player_uuid,stats,games!inner(tipoff_at,competition_id,home_score,away_score,status,` +
    `home:home_team_id(name,slug),away:away_team_id(name,slug))` +
    (comps.length ? `&games.competition_id=in.(${comps.join(',')})` : '') + `&limit=80`);
  const rows = gl.filter(r => r.games)
    .sort((a, b) => new Date(b.games.tipoff_at || 0) - new Date(a.games.tipoff_at || 0))
    .map(r => {
      const g = r.games;
      const home = r.team_idx === 0;
      const us = home ? g.home_score : g.away_score;
      const them = home ? g.away_score : g.home_score;
      return Object.assign({}, r, {
        __home: home,
        __opp: home ? g.away : g.home,
        __res: g.status === 'final' ? (us > them ? 'W ' + us + '-' + them
                                                 : 'L ' + us + '-' + them) : ''
      });
    });
  try { await logBPM(rows); } catch (e) { console.warn('[log bpm]', e); }
  paintLog(rows, new Map((sn ? sn.comps : []).map(c => [c.id, c.short || c.name || ''])));
  LOG_ROWS = rows;                                   // 3PT CONSISTENCY is worked out now, from the log just read
  if (LAST_BARS) paintBars(LAST_BARS.mine, LAST_BARS.field);
  paintPosBreakdown(rows, LAST_BARS && LAST_BARS.field).catch(e => console.warn('[positions]', e));
}

/* ------------------------------------------------------------------- boot --- */
(async function boot() {
  if (!want) return fail('No player specified.');
  try {
    const key = isUuid ? 'id' : 'slug';
    /* Named columns, not select=*: a guardian's name and the account that
       recorded consent are not public columns (0171), and * asks for them. */
    const ps = await api(`players?${key}=eq.${encodeURIComponent(want)}` +
      '&select=id,slug,first_name,last_name,birth_year,is_minor,photo_media_id,photo_consent,' +
      'created_by,created_at,photo_url,height_cm,weight_kg,wingspan_cm,previous_club,' +
      'public_consent,consent_at,aliases,external_ids&limit=1');
    if (!ps.length) {
      /* A PROFILE THAT WAS MERGED INTO ANOTHER (migration 0183) keeps its address: the old id or slug leads to the one that stayed */
      try {
        const mv = await api('player_merges?' + (isUuid ? 'old_id=eq.' : 'old_slug=eq.') + encodeURIComponent(want) + '&select=into_id&limit=1');
        if (mv.length && mv[0].into_id) {
          const q = new URLSearchParams(location.search); q.set('p', mv[0].into_id);
          location.replace(location.pathname + '?' + q.toString() + location.hash);
          return;
        }
      } catch (_) { /* before 0183 there is no such table: the message below */ }
      return fail('This profile is not public. Under-18 players are only visible to their club.');
    }
    const pl = ps[0];

    /* the approved photograph, if the league has passed one */
    if (pl.photo_media_id) {
      try {
        const md = await api(`media?id=eq.${pl.photo_media_id}` +
                             `&status=eq.approved&select=storage_path&limit=1`);
        if (md.length) pl.__photoPath = md[0].storage_path;
      } catch (_) { /* an unapproved or withdrawn photo simply does not show */ }
    }

    const re = await api(`roster_entries?player_id=eq.${pl.id}` +
      `&select=jersey,position,teams(id,name,slug,colour,colour_2,colour_source,short_name,logo_path,leagues(id,slug,name,logo_path,colour_a))&order=created_at.desc&limit=1`);
    const entry = re[0] || {};
    const team = entry.teams || null;
    paintIdentity(pl, entry, team);
    if (window.EpinoiaLinks) {
      LINKED_P = window.EpinoiaLinks.loadPlayer(pl.id);
      LINKED_P.then(l => window.EpinoiaLinks.paintPlayer(pl, l, { sub: $('#sub') })).catch(() => { /* no switcher */ });
    }
    /* the club's own button, if this is the club's own person (nothing is fetched for anybody else) */
    offerRelease(pl, team).catch(() => { /* no button */ });
    if (team && team.leagues && team.leagues.slug) window.__CS_LEAGUE_SLUG = team.leagues.slug;
    /* analytics: which player, and the club and league he or she is in (the player by id) */
    try { if (window.EpinoiaTrack && window.EpinoiaTrack.entity) window.EpinoiaTrack.entity({ player: pl.id, team: team && team.slug, league: team && team.leagues && team.leagues.slug }); } catch (_) { /* a count is never worth a page */ }

    /* ---- access ----
       ANSWERED BEFORE HIS CLUB'S GAMES ARE READ, not beside that read. data.js fixes a
       request's headers the moment the request is made, and a token rides on it only once
       access.js holds this league's answer -- so the games read that used to go out while
       the answer was still on its way was always anonymous, row-level security refused it
       in a members-only league, and a member got an empty season every time. Everything
       read above (the player, his photo, his roster entry) is the shop window and does not
       wait. Asked by id, since a slug would cost a leagues read first.
       The wait is bounded: load() never rejects, gives up by itself after four seconds and
       answers open, and an answer given on the league page a moment ago is cached, so an
       open league's profile is held for one small request at most. */
    const A = window.EpinoiaAccess;
    const lgRow = (team && team.leagues && team.leagues.id) ? team.leagues : null;
    if (A && typeof A.load === 'function') {
      /* a free agent has no league to ask about, but the platform's analytics default still
         applies to him: load({}) asks for the no-league answer (access_state's top-level
         analytics_ok), so his bars follow the same switch as everybody else's */
      try { await A.load(lgRow ? { leagueId: lgRow.id } : {}); } catch (_) { /* open, as every failure is */ }
    }
    if (A) {
      const lockedNow = () => typeof A.analyticsOk === 'function' && !A.analyticsOk(lgRow ? lgRow.id : null);
      const locksNow = () => { const o = {}, lid = lgRow ? lgRow.id : null;
        PLAYER_LOCK_KEYS.forEach(k => { o[k] = typeof A.featureLocked === 'function' ? !!A.featureLocked(k, lid) : lockedNow(); }); return o; };
      const locksSig = o => PLAYER_LOCK_KEYS.map(k => (o[k] ? 1 : 0)).join('');
      const shutNow = () => { if (!lgRow || typeof A.get !== 'function' || typeof A.canView !== 'function') return false;
        const s = A.get(lgRow.id); return !!(s && s.known) && !A.canView(lgRow.id); };
      if (lgRow) ACCESS_LEAGUE = { id: lgRow.id, slug: lgRow.slug || '' };
      ANALYTICS_LOCKED = lockedNow();
      PLAYER_LOCKS = locksNow();
      /* THE ANSWER CAN MOVE UNDER A DRAWN PAGE: a sign-in or sign-out in another tab, an answer
         that lands after the module's time limit, the admin preview switch. The bars, the
         events, the shot chart and the teammate panel were all drawn from it, so a change to
         what was decided draws the page again from the top; an open league never notices. On a
         change of account the new account's answer is waited for, not the empty state between.
         Answers about his OTHER leagues (loadCareerAccess, membersOnly) are not this page's
         decision and are ignored here, so loading them can never start a reload. */
      const drawn = ANALYTICS_LOCKED + '|' + shutNow() + '|' + locksSig(PLAYER_LOCKS);
      if (typeof A.onChange === 'function') {
        const check = () => { if (lockedNow() + '|' + shutNow() + '|' + locksSig(locksNow()) !== drawn) location.reload(); };
        try {
          A.onChange(d => {
            if (d && d.leagueId && (!lgRow || d.leagueId !== lgRow.id)) return;
            if (d && d.reason === 'auth' && lgRow && typeof A.load === 'function') {
              Promise.resolve().then(() => A.load({ leagueId: lgRow.id })).then(check, () => {});
            } else check();
          });
        } catch (_) { /* the page as drawn */ }
      }
      /* the card is drawn in place of the statistics, and nothing behind it is fetched -- not
         even the club's games, which the database would refuse every row of anyway */
      if (lgRow && await membersOnly(pl, lgRow)) return;
    }
    /* his other leagues, for the career table and the game log: asked now so the answers
       arrive while the season is being drawn, rather than after it (never rejects) */
    const careerAccess = loadCareerAccess(pl, lgRow);

    /* ---- the season, from the shared intermediary ----
       Aggregated the same way as the leaders board, so the two cannot
       disagree, and computed across the whole competition so this player can
       be ranked against everyone else in it. */
    const D = window.EpinoiaData;
    let mine = null, field = [];
    /* WHICH SEASON, AND WHICH COMPETITION OF IT (2026-10-02). Every season he has played, under this profile and every
       profile linked to it (0178: the same person in another competition's feed), newest first, and in the season shown
       every competition he played (playerScopes). The hero's tiles, the percentile bars, the events and the game log are
       that season's - all of it, or one competition - and the hero says which. The scope used to be every competition
       his club had ever played, every season at once: one line added up across seasons, which no season ever had.
       ?s= names the season, ?c= a competition of it; both can be sent and reloaded into. */
    const scopes = await playerScopes(pl, team);
    const SEASONS = scopes.seasons;
    const KIND_LABEL = { league: 'League', cup: 'Cup', trophy: 'Trophy', playoff: 'Playoffs', friendly: 'Friendlies' };
    const q0 = new URLSearchParams(location.search);
    let SEASON = pickScopeSeason(SEASONS, q0.get('s'));
    let scopeKind = 'all';
    /* the label the events panel names its rows for: computed here, apart from
       any markup, and escaped by the panel itself */
    const fullName = ((pl.first_name || '') + ' ' + (pl.last_name || '')).trim();
    /* a competition as a reader names it (playerScopes: SLB, SLB Cup, EuroCup), its own name where there is no short one */
    const compName = c => c.short || c.name || KIND_LABEL[c.kind] || c.kind || '';
    const paintScope = async kind => {
      scopeKind = kind;
      RP_SEASON = SEASON;
      const comps = SEASON ? SEASON.comps : [];
      const ids = comps.filter(c => kind === 'all' || c.id === kind).map(c => c.id);
      /* the profile he played these under: his own, or the linked one the season line knows him by there */
      const pids = new Set(comps.filter(c => ids.indexOf(c.id) >= 0).map(c => c.pid));
      mine = null; field = []; SCOPE_IDS = ids; let sosGames = null, teamOf = null;
      simOpen = false; SIM_CTX = null; SIM_CTL = null; CMP_CTX = null;
      try {
        if (ids.length) {
          const S = await D.season(ids, { rows: false, trim: true });
          sosGames = S.games;
          SCOPE_GAME_COUNT = (S.games || []).length;
          SCOPE_GAMES = (S.games || []).map(g => g.id).filter(Boolean);
          RP_FIELD = null;                                                   // another scope: its own games' logs
          field = S.players;
          mine = field.find(r => pids.has(r.id)) || field.find(r => r.id === pl.id) || null;
          teamOf = S.teamOfPlayer || null;
        }
      } catch (e) { console.warn('[season]', e); }
      /* the line the similar-players file is for: the one competition shown, or (all competitions) the league's own */
      if (mine) {
        const simC = kind === 'all'
          ? (comps.find(c => ids.indexOf(c.id) >= 0 && c.kind === 'league') || comps.find(c => ids.indexOf(c.id) >= 0))
          : comps.find(c => c.id === kind);
        if (simC) SIM_CTX = { cid: simC.id, pid: simC.pid || pl.id, name: fullName,
          basis: kind === 'all' && ids.length > 1 ? compName(simC) + ' line' : '' };
        /* what the compare chart calls this line: the competition shown (all of a season: its league, SLB) and the season,
           SLB 25-26 -- the other player is named the same way -- and the club he played it for */
        const GL = window.EpinoiaGlobal;
        const inScope = comps.filter(c => ids.indexOf(c.id) >= 0);
        const leaguesIn = [...new Set(inScope.map(c => (c.leagueRow && GL ? GL.leagueShort(c.leagueRow) : c.league)).filter(Boolean))];
        const what = kind === 'all' ? (leaguesIn.join(' + ') || compName(inScope[0] || {})) : compName(inScope[0] || {});
        const sname = (SEASON && SEASON.name) || '';
        const teamId = teamOf && teamOf.get ? teamOf.get(mine.id) : null;
        CMP_CTX = { mine, field, name: fullName, label: (what + ' ' + (GL ? GL.shortSeason(sname) : sname)).trim(),
          team: team && teamId === team.id ? { name: team.name, short: team.short_name, colour: team.colour, logo: team.logo_path } : null,
          teamId, photo: (pl.__photoPath && window.EpinoiaUpload ? window.EpinoiaUpload.publicUrl(CFG, pl.__photoPath) : null) || pl.photo_url || null,
          leagueId: lgRow ? lgRow.id : null, leagueRow: lgRow, seasonName: sname };
      }
      paintTiles(mine, field);
      paintBars(mine, field);
      clutchWhenNear(ids, pl.id, team);
      if (window.EpinoiaSosChip) window.EpinoiaSosChip.paint(null, { games: sosGames, teamId: team && team.id });
      /* ---- events ----
         The season's situations (second chance, transition, off turnovers,
         after timeout, half court) and assisted baskets, read from the same
         scoped rows as the bars above and ranked against the same field. Its
         own try: a panel that cannot draw must never reach boot's catch, which
         wipes the season table and the game log. */
      try {
        const evHost = $('#events');
        /* without analytics the section stays, with the teaser where the panel would be */
        if (evHost && pLocked('events')) {
          evHost.innerHTML = accessTeaser({ key: 'events', title: 'Events',
            lines: ['Second chances, transition, points off turnovers, after-timeout sets, the half court and assisted baskets, ranked against the league.'] });
          { const M = window.EpinoiaMemLock, ph = M && M.placeholder({ what: 'Events', key: 'events', leagueSlug: ACCESS_LEAGUE.slug }); if (ph) evHost.insertBefore(ph, evHost.firstChild); }
        } else if (evHost && window.EpinoiaSitPanel) {
          window.EpinoiaSitPanel.render({ host: evHost, kind: 'player', row: mine, field, name: fullName });
          const en = $('#eventsNote');
          if (en) en.textContent = kind === 'all' ? '' : compName(comps.find(c => c.id === kind) || {});
        }
      } catch (e) { console.warn('[events]', e); }
      const bn = $('#barNote');
      if (bn && kind !== 'all') bn.textContent = (bn.textContent || '').replace(/ · .*$/, '') + ' · ' + compName(comps.find(c => c.id === kind) || {});
      paintScopeLabel(SEASON, kind);
      document.querySelectorAll('#pscopeC .ep-chip').forEach(b => b.classList.toggle('on', b.dataset.k === kind));
      markCareer();
      /* the breakdown follows the competition chosen; a new season's is drawn when its log arrives (seasonLog) */
      if (LOG_ROWS && LOG_ROWS.some(r => ids.indexOf((r.games || {}).competition_id) >= 0)) paintPosBreakdown(LOG_ROWS, field).catch(() => {});
      else { const ip = $('#idpos'); if (ip) { ip.hidden = true; ip.textContent = ''; } }
    };
    /* the chips: the seasons (more than one), and the competitions of the season shown (more than one). ALL is offered
       only where one profile played them all: two profiles' season lines are two people's to the season maths. */
    const drawComps = () => {
      const comps = SEASON ? SEASON.comps : [];
      const kinds = (allOk(SEASON) ? [['all', 'All']] : []).concat(comps.map(c => [c.id, compName(c)]));
      const host = $('#pscopeC');
      if (host) host.textContent = '';
      if (kinds.length > 1 && host) {
        kinds.forEach(([k, lab]) => {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'ep-chip' + (k === scopeKind ? ' on' : ''); b.dataset.k = k; b.textContent = lab;
          if (k !== 'all') b.setAttribute('translate', 'no');
          b.onclick = () => { if (k !== scopeKind) { paintScope(k); syncScopeUrl(SEASON, k); } };
          host.appendChild(b);
        });
      }
      const row = $('#pscopeComps');
      if (row) row.hidden = !(kinds.length > 1);
      return kinds;
    };
    const firstKind = () => (allOk(SEASON) ? 'all' : ((SEASON && SEASON.comps[0]) || {}).id || 'all');
    const chooseSeason = async (sn, kind, picked) => {
      SEASON = sn;
      scopeKind = kind && SEASON && (kind === 'all' ? allOk(SEASON) : SEASON.comps.some(c => c.id === kind)) ? kind : firstKind();
      drawSeasons();
      drawComps();
      if (picked) syncScopeUrl(SEASON, scopeKind);   // the reader's choice goes in the address; the default does not
      await paintScope(scopeKind);
    };
    const drawSeasons = () => {
      const host = $('#pscopeS');
      if (host) host.textContent = '';
      if (SEASONS.length > 1 && host) {
        SEASONS.forEach(sn => {
          const a = document.createElement('a');
          a.className = 'ep-chip' + (sn === SEASON ? ' on' : ''); a.textContent = sn.label;
          a.href = scopeHref(sn, null);
          if (sn === SEASON) a.setAttribute('aria-current', 'true');
          a.addEventListener('click', ev => {
            /* a modified click is the reader asking for a new tab */
            if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button) return;
            ev.preventDefault();
            if (sn === SEASON) return;
            chooseSeason(sn, null, true).then(() => seasonLog(scopes.ids, SEASON)).catch(e => console.warn('[scope]', e));
          });
          host.appendChild(a);
        });
      }
      const row = $('#pscopeSeasons');
      if (row) row.hidden = !(SEASONS.length > 1);
      const box = $('#pscope');
      if (box) box.hidden = !(SEASONS.length > 1 || (SEASON && SEASON.comps.length > 1));
    };
    await chooseSeason(SEASON, q0.get('c'));

    /* ---- career, a row per season ----
       One line was fine when nobody had a second season. A career table is the
       thing a profile is actually for, and it is built through the SAME
       intermediary as the current season so every column means what it means
       everywhere else — a career table assembled from a different query is how
       a profile ends up disagreeing with the leaders board it links to.
       It waits for his other leagues' answers (started beside the season above),
       and so does everything after it: the game log reads across them too. */
    await careerAccess;
    await paintCareer(pl, team, scopes, {
      current: () => ({ label: SEASON ? SEASON.label : '', kind: scopeKind }),
      /* a row pressed: that season and competition on this profile, as its chips would, and the hero brought into view */
      pick: (label, cid) => {
        const sn = SEASONS.find(x => x.label === label);
        if (!sn) return;
        chooseSeason(sn, cid, true).then(() => {
          const top = $('#pscope') && !$('#pscope').hidden ? $('#pscope') : $('#tiles');
          if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return seasonLog(scopes.ids, SEASON);
        }).catch(e => console.warn('[career pick]', e));
      }
    });

    /* ---------------------------------------------------------------------------
   THE SHOT CHART, AND THE TWO NUMBERS THAT MAKE IT READABLE.

   Cell size and the attempt floor are exposed because the right values depend
   on how much a player has played: a season of eighteen games supports smaller
   cells and a higher floor than a run of three. The defaults are a stride and
   a bit (120cm) and two attempts, which is the point at which a cell stops
   being one shot somebody happened to take.
   --------------------------------------------------------------------------- */
let SHOTS = [];
/* redraw on either control, and only bind once */
document.addEventListener('change', e => {
  if (e.target && (e.target.id === 'scCell' || e.target.id === 'scMin')) drawShotChart();
});
let SHOT_COLOUR = null, SHOT_GAMES = 0, SHOT_GAMELIST = null;
function drawShotChart(shots, colour, games, gameList) {
  if (shots) SHOTS = shots;
  if (colour) SHOT_COLOUR = colour;
  if (games) SHOT_GAMES = games;
  if (gameList) SHOT_GAMELIST = gameList;
  if (shots) rpGive('shots', { shots: SHOTS, games: SHOT_GAMES, colour: SHOT_COLOUR, gameList: SHOT_GAMELIST });
  const host = document.querySelector('#shotchart');
  if (!host || !window.EpinoiaShotChart) return;
  /* THE BOX SCORE'S CHART, over the season: every located shot as a dot or a cross in the
     club's colour, the floor cut into zones with each zone's makes, attempts and percentage */
  /* without analytics: the same court and the same marks, no zones -- and a line saying
     what the zones would add */
  window.EpinoiaShotChart.renderZones({ host, shots: SHOTS, colour: SHOT_COLOUR || '#93f2bf', minAttempts: 3, games: SHOT_GAMES,
    gameList: SHOT_GAMELIST, zones: !pLocked('shotZones') });
  if (pLocked('shotZones')) {
    host.insertAdjacentHTML('beforeend', accessTeaser({ compact: true, key: 'shotZones', title: 'Shot zones',
      lines: ['Twelve zones, each tinted against its own break-even, with a zone-by-zone table.'] }));
  }
}

/* ---- on the floor with ----
       The team's on/off as tiles, then this player's OWN numbers split by who
       was beside him. The second is derived by replaying the event log — no
       table stores an individual box broken down by teammate — so it needs the
       log, the stints for shared minutes, and the frozen starters to know who
       was on the floor before the first substitution. */
    try {
      if (team && team.id) {
        /* BOUNDED, BECAUSE A CAREER IS NOT WHAT A READER IS LOOKING AT.

           This asked for every game the club has ever played and then fetched
           the full event log of each — which is right for four games and
           ruinous for two hundred. The lineup work below is about who this
           player has been on the floor with lately; the career table above it
           already covers the long view and reads pre-aggregated season rows.

           Newest first and capped, so the cost of this page is the same in a
           league's fifth season as in its first. */
        const RECENT_GAMES = 40;
        const gs = await D.all(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})` +
          `&status=eq.final&select=id,home_team_id,away_team_id,starters,tipoff_at,competition_id,period` +
          `&order=tipoff_at.desc&limit=${RECENT_GAMES}`);
        if (!gs.length) {
          $('#withpanel').appendChild(el('div', 'empty',
            'No finalised games yet — this fills in once one is played.'));
        } else {
          const byGame = {}; gs.forEach(g => { byGame[g.id] = g; });
          const [st, evs] = await Promise.all([
            D.stints(gs.map(g => g.id), team.id, byGame),
            D.events(gs.map(g => g.id))
          ]);
          /* the position breakdown reads these games' lineups from here, not again (both sides are not needed: his) */
          gs.forEach(g => { if (!CLUB_STINTS.has(g.id)) CLUB_STINTS.set(g.id, []); });
          st.forEach(x => { const l = CLUB_STINTS.get(x.game_id); if (l && l.indexOf(x) < 0) l.push(x); });

          /* the same games, for his numbers against the starters and the bench: nothing is read twice */
          const logsOf = new Map();
          evs.forEach(e => { if (!logsOf.has(e.gameId)) logsOf.set(e.gameId, []); logsOf.get(e.gameId).push(e); });
          clubLogsDone({ games: gs, byGame: logsOf, capped: gs.length >= RECENT_GAMES ? RECENT_GAMES : 0 });

          window.EpinoiaWowy.onOffTiles('#onoff', st, pl.id);

          const games = gs.map(g => ({
            starters: g.starters,
            events: evs.filter(e => e.gameId === g.id)
          }));
          const recs = window.EpinoiaWith.index(games);

          /* ---- the season shot chart ----
             Built from the events already in hand rather than a second trip:
             locations live in the log, not in the season aggregates, and this
             block has just fetched the whole log for every game the club
             played. Grouped by game because a 'loc' event references its shot
             by an id that only means anything within its own game. */
          try {
            const byG = {};
            evs.forEach(e => { (byG[e.gameId] = byG[e.gameId] || []).push(e); });
            const shots = await window.EpinoiaShotChart.gather({
              fetchEvents: async () => Object.values(byG),
              gameIds: gs.map(g => g.id),
              playerId: pl.id
            });
            /* games this player appeared in among those fetched: a game with an event of theirs */
            const played = new Set(evs.filter(e => String(e.pid) === String(pl.id)).map(e => e.gameId));
            const SC = window.EpinoiaShotChart;
            drawShotChart(shots, (team && team.colour) || null, played.size,
              SC.gameListOf ? SC.gameListOf(gs.filter(g => played.has(g.id))) : null);
          } catch (e) { /* a chart is not worth breaking the page for */ }

          /* ---- on video ----
             The whole log for every game the club played is already in hand,
             so this costs exactly one more query: which of those games has
             footage attached. Anything without a video, or with one that has
             not been lined up with the game clock, is filtered out by the
             panel itself — a list of plays that cannot be found in a video is
             worse than no list. */
          try {
            /* CHUNKED, because an in.() list is a URL and a URL has a length.

               Forty uuids is 1.5KB of query string before anything else; a
               league where a club has played two hundred games would build one
               past every proxy's default header limit and fail with a 414 that
               says nothing about video. Forty at a time is what the rest of
               this file already uses, for the same reason. */
            const inChunks = async (ids, build) => {
              const out = [];
              for (let i = 0; i < ids.length; i += 40) {
                out.push(...await api(build(ids.slice(i, i + 40))));
              }
              return out;
            };
            const vids = await inChunks(gs.map(g => g.id), c =>
              'game_videos?game_id=in.(' + c.join(',') + ')' +
              '&is_primary=eq.true&select=game_id,url,provider,video_ref,label,' +
              'stream_started_at,tip_at,tip_wall,tip_offset_ms,trim_ms,clock_track');
            const byGameV = {};
            vids.forEach(v => { if (v.url) byGameV[v.game_id] = v; });
            if (Object.keys(byGameV).length && window.EpinoiaPlayerVideo) {
              const meta = {};
              (await inChunks(Object.keys(byGameV), c =>
                'games?id=in.(' + c.join(',') + ')' +
                '&select=id,tipoff_at,home:home_team_id(short_name,name),' +
                'away:away_team_id(short_name,name)')).forEach(g => { meta[g.id] = g; });

              const withVideo = Object.keys(byGameV).map(id => {
                const m = meta[id] || {};
                const h = (m.home || {}).short_name || (m.home || {}).name || 'home';
                const a = (m.away || {}).short_name || (m.away || {}).name || 'away';
                return {
                  id, video: byGameV[id], date: m.tipoff_at,
                  title: h + ' v ' + a +
                    (m.tipoff_at ? ' · ' + new Date(m.tipoff_at).toLocaleDateString() : ''),
                  events: evs.filter(e => e.gameId === id)
                };
              });
              /* names for the ASSIST tags and for "by <shooter>" on his assists */
              const names = {};
              try {
                const pids = [...new Set(evs.map(e => e.pid).filter(Boolean))];
                const meta = await D.playerMeta(pids);
                Object.keys(meta).forEach(id => { if (meta[id] && meta[id].name) names[id] = meta[id].name; });
              } catch (_) { /* tags fall back to "assisted" */ }
              const shown = window.EpinoiaPlayerVideo.render({
                host: '#videopanel', games: withVideo, playerId: pl.id, names: names
              });
              if (shown) {
                $('#videoNote').textContent = withVideo.length +
                  (withVideo.length === 1 ? ' game with footage' : ' games with footage');
                /* THE VIDEO TAB. The section stays out of the profile's flow and gets a
                   tab of its own beside the profile, shown only when there is footage. */
                const tabs = $('#ptabs');
                if (tabs) {
                  tabs.style.display = '';
                  const showVideo = on => {
                    document.body.classList.toggle('vtab', on);
                    $('#videosec').style.display = on ? '' : 'none';
                    tabs.querySelectorAll('.ep-tab').forEach(b => b.classList.toggle('on', (b.dataset.p === 'video') === on));
                    if (on) window.scrollTo({ top: tabs.getBoundingClientRect().top + window.scrollY - 12, behavior: 'smooth' });
                  };
                  tabs.querySelectorAll('.ep-tab').forEach(b => { if (b.dataset.p === 'profile' || b.dataset.p === 'video') b.onclick = () => showVideo(b.dataset.p === 'video'); });
                  if (new URLSearchParams(location.search).get('tab') === 'video') showVideo(true);
                }
              }
            }
          } catch (e) {
            /* Before 0082 is applied the table does not exist, and a profile
               that cannot show video is a profile, not a failure. */
            console.warn('[video]', e);
          }

          /* teammates are whoever actually shared a stint with him */
          const mates = new Set();
          st.forEach(s3 => {
            const ids = s3.player_ids || [];
            if (ids.indexOf(pl.id) === -1) return;
            ids.forEach(id => { if (id !== pl.id) mates.add(id); });
          });
          const mm = await D.playerMeta([...mates]);
          { const logs = {}, sideOf = {}; logsOf.forEach((v, k) => { logs[k] = v; }); gs.forEach(g => { sideOf[g.id] = g.home_team_id === team.id ? 0 : 1; });
            rpGive('floor', { stints: st, recs, meta: mm, playerId: pl.id, logs, sideOf }); }
          $('#wowyNote').textContent = st.length + ' stints · ' + mates.size + ' teammates' +
            (gs.length >= RECENT_GAMES ? ' · last ' + RECENT_GAMES + ' games' : '');

          /* locked: withui.js draws its compact teaser in place of the teammate comparison */
          window.EpinoiaWithUI.render({
            host: '#withpanel', recs, stints: st, playerId: pl.id,
            meta: mm, teammates: [...mates], locked: pLocked('wowy'), leagueSlug: ACCESS_LEAGUE.slug
          });
        }
      }
    } catch (e) {
      console.warn('[with]', e);
      if (!$('#withpanel').children.length) {
        $('#withpanel').appendChild(el('div', 'empty',
          'Could not load lineup data: ' + (e.message || e)));
      }
    }

    /* game log, the season shown (seasonLog) */
    await seasonLog(scopes.ids, SEASON);
  } catch (e) {
    fail('Could not load: ' + e.message);
  } finally {
    clubLogsDone(null);                                // no club, no games, an early return: the split says so rather than waits
    ['floor', 'shots'].forEach(k => { if (!rpSlot(k).done) rpGive(k, null); });   // a piece never worked out: nothing, not a wait
  }
})();
