'use strict';
/* ============================================================================
   THE NEWSDESK, ON A PAGE — window.EpinoiaNewsdesk.

   The league's newsdesk (epinoia/narrative.js, built every hour by tools/build-narratives.mjs into the public file
   snapshots/narrative/<league id>.json) drawn as cards: on a league's front page, its running storylines and the day's
   briefing; in the creator hub, the whole coverage plan as well.

   SINCE YOUR LAST VISIT. This browser remembers the version of each storyline it has shown (localStorage, this device
   only, nothing sent anywhere): one it has never shown is NEW, one that has moved on since is UPDATED with its note of
   what changed, one that has finished is RESOLVED with how it ended.

   Every string from the file is escaped. The generated sentences are English, written from templates, and translated
   whole in the 'newsdesk' sentence context (i18n/<code>/newsdesk.js: one anchored pattern per template, so a sentence
   is either translated whole or left whole in English, never half). Names and other sites' titles keep translate="no".

     EpinoiaNewsdesk.load(leagueId)                    -> Promise<build | null>
     EpinoiaNewsdesk.storiesHTML(build, {base, max, seen})   cards
     EpinoiaNewsdesk.briefingHTML(build, {base})        the day in the league
     EpinoiaNewsdesk.coverageHTML(build, {base, write})  the creator hub's coverage plan
     EpinoiaNewsdesk.planText(build)                    the plan as plain text, to copy
     EpinoiaNewsdesk.seen(leagueId) / markSeen(leagueId, build)
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaNewsdesk = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SEEN_KEY = 'epinoia_newsdesk_seen';
const HOUR = 3600000, DAY = 86400000;
/* only links the file itself makes, to the site's own pages */
/* only the site's own pages, by a short list: a game, a club, a player, a league, a news story or article, a creator's
   piece, a game's highlights; each with a few plain parameters */
const safeHref = (base, h) => (/^(game|t|p|l|news|creators|watch)\/\?[a-z]=[\w%.:-]+(?:&[a-z]=[\w%.:-]+){0,3}$/i.test(String(h || '')) ? (base || '') + h : null);

/* ------------------------------------------------------------------- read --- */
async function load(leagueId, opts) {
  const C = (opts && opts.config) || root.EPINOIA_CONFIG;
  if (!leagueId || !C || !C.supabaseUrl || typeof fetch !== 'function') return null;
  try {
    const r = await fetch(C.supabaseUrl + '/storage/v1/object/public/snapshots/narrative/' + encodeURIComponent(leagueId) + '.json');
    if (!r.ok) return null;
    const b = await r.json();
    return b && b.v === 1 && Array.isArray(b.stories) && b.league && String(b.league.id) === String(leagueId) ? b : null;
  } catch (_) { return null; }
}

/* ------------------------------------------------- since your last visit --- */
function seen(leagueId) {
  try { const all = JSON.parse(root.localStorage.getItem(SEEN_KEY) || '{}'); return (all && all[leagueId]) || {}; } catch (_) { return {}; }
}
function markSeen(leagueId, build) {
  if (!build || !leagueId) return;
  try {
    const all = JSON.parse(root.localStorage.getItem(SEEN_KEY) || '{}') || {};
    const mine = {};
    build.stories.forEach(s => { mine[s.id] = s.version || 1; });
    all[leagueId] = mine;
    /* a few leagues, not every league ever opened */
    const keys = Object.keys(all);
    if (keys.length > 24) keys.slice(0, keys.length - 24).forEach(k => { delete all[k]; });
    root.localStorage.setItem(SEEN_KEY, JSON.stringify(all));
  } catch (_) { /* private mode: no badges, nothing lost */ }
}
function badgeOf(s, was) {
  if (s.status === 'resolved') return ['res', 'Resolved'];
  if (!was) return s.status === 'new' ? ['new', 'New'] : ['new', 'New to you'];
  if ((s.version || 1) > was) return ['upd', 'Updated'];
  return null;
}
function ago(iso) {
  const t = Date.parse(iso);
  if (!isFinite(t)) return '';
  const h = Math.max(0, (Date.now() - t) / HOUR);
  if (h < 1) return 'updated in the last hour';
  if (h < 24) return 'updated ' + Math.round(h) + (Math.round(h) === 1 ? ' hour ago' : ' hours ago');
  const d = Math.round(h / 24);
  return 'updated ' + d + (d === 1 ? ' day ago' : ' days ago');
}

/* a date as "2 Oct" (the page's language wraps toLocaleDateString, so a Japanese reader sees 10月2日) */
const dayShort = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
/* a score or a record never breaks at its dash ("5–" at the end of one line, "0" at the start of the next). On an English
   page only: the wrapper splits a sentence into separate text nodes, and a translated page translates each sentence whole
   (the newsdesk pack's patterns), so there it is left in one piece */
const nb = html => (root.EpinoiaI18n && root.EpinoiaI18n.lang && root.EpinoiaI18n.lang !== 'en'
  ? String(html) : String(html).replace(/(\d+)–(\d+)/g, '<span class="nd-nb">$1–$2</span>'));

/* ------------------------------------------------------------- a storyline --- */
const PIECE = { report: 'Match report', creator: 'From a creator', news: 'In the news' };
/* the links that are the newsdesk's own words, not names */
const OWN_LINK = new Set(['the game', 'the highlights', 'the player']);
function storyHTML(s, o) {
  const opts = o || {};
  const b = badgeOf(s, (opts.seen || {})[s.id]);
  const nums = (s.numbers || []).slice(0, opts.full ? 8 : 4).map(n =>
    '<div><dt>' + esc(n.label) + '</dt><dd>' + esc(n.value) + '</dd></div>').join('');
  /* a link is a name (a club, a player: never translated) or one of the newsdesk's own words (translated) */
  const links = (s.links || []).map(l => { const h = safeHref(opts.base, l.href); return h ? '<a href="' + esc(h) + '"' + (OWN_LINK.has(l.label) ? '' : ' translate="no"') + '>' + esc(l.label) + '</a>' : ''; }).filter(Boolean).join('');
  const line = (cls, label, text) => (text ? '<p class="' + cls + '"><b>' + label + '</b> <span>' + nb(esc(text)) + '</span></p>' : '');
  return '<article class="nd-story" data-i18n-ctx="newsdesk" data-kind="' + esc(s.kind) + '" data-status="' + esc(s.status) + '">' +
    '<div class="nd-top"><span class="nd-kick">' + esc(s.kicker) + '</span>' + (b ? '<span class="nd-badge ' + b[0] + '">' + b[1] + '</span>' : '') + '</div>' +
    '<h3 class="nd-h">' + nb(esc(s.head)) + '</h3>' +
    (s.dek ? '<p class="nd-dek">' + nb(esc(s.dek)) + '</p>' : '') +
    (b && b[0] !== 'new' && s.change ? '<p class="nd-change">' + esc(s.change) + '</p>' : '') +
    (nums ? '<dl class="nd-nums">' + nums + '</dl>' : '') +
    line('nd-why', 'Why it matters', s.why) +
    (opts.full ? (s.body || []).map(x => '<p class="nd-body">' + esc(x) + '</p>').join('') : '') +
    line('nd-but', 'Yes, but', s.counter) +
    line('nd-next', 'What’s next', s.next) +
    (opts.full && (s.angles || []).length ? '<div class="nd-angles"><b>Ways to cover it</b><ul>' + s.angles.map(a => '<li>' + esc(a) + '</li>').join('') + '</ul></div>' : '') +
    /* how it has developed: the storyline's timeline, once it has moved at least once */
    (opts.full && (s.history || []).length >= 2 ? '<div class="nd-angles nd-hist"><b>How it has developed</b><ol>' + s.history.map(h =>
      '<li><span class="nd-hat">' + esc(dayShort(h.at)) + '</span> <span>' + nb(esc(h.what)) + '</span></li>').join('') + '</ol></div>' : '') +
    /* the questions a desk would take to the press conference, each to a club's coach or a player */
    (opts.full && (s.questions || []).length ? '<div class="nd-angles nd-qs"><b>Questions to ask</b><ul>' + s.questions.map(x =>
      '<li><span class="nd-qto">' + esc(x.to) + '</span> <span>' + nb(esc(x.q)) + '</span></li>').join('') + '</ul></div>' : '') +
    /* what the site has already published about it: a creator's piece, the news, the match report */
    (opts.full && (s.pieces || []).length ? '<div class="nd-angles nd-pieces"><b>Already written</b><ul>' + s.pieces.map(x => {
      const h = safeHref(opts.base, x.href);
      return h ? '<li><a href="' + esc(h) + '" translate="no">' + esc(x.title) + '</a> <small>' + esc(PIECE[x.kind] || PIECE.news) + '</small></li>' : '';
    }).join('') + '</ul></div>' : '') +
    '<div class="nd-foot"><span class="nd-time">' + esc(s.status === 'resolved' ? 'finished' : ago(s.updated)) + '</span>' + (links ? '<span class="nd-links">' + links + '</span>' : '') +
      (opts.actions ? '<span class="nd-acts" data-story="' + esc(s.id) + '"></span>' : '') + '</div>' +
  '</article>';
}
function storiesHTML(build, o) {
  const opts = o || {};
  if (!build || !build.stories || !build.stories.length) return '';
  const live = build.stories.filter(s => s.status !== 'resolved');
  const done = build.stories.filter(s => s.status === 'resolved').slice(0, opts.resolved == null ? 2 : opts.resolved);
  const list = live.slice(0, opts.max || 6).concat(done);
  return '<div class="nd-grid">' + list.map(s => storyHTML(s, opts)).join('') + '</div>';
}

/* --------------------------------------------------------------- the briefing --- */
function briefingHTML(build, o) {
  const opts = o || {};
  const B = build && build.briefing;
  if (!B) return '';
  const lead = build.stories.find(s => s.id === B.lead);
  const row = (x, cls) => {
    const h = x.game ? safeHref(opts.base, 'game/?g=' + x.game) : null;
    return '<li class="' + cls + '">' + (h ? '<a href="' + esc(h) + '">' + nb(esc(x.line)) + '</a>' : '<span>' + nb(esc(x.line)) + '</span>') +
      (x.sub ? '<small>' + nb(esc(x.sub)) + '</small>' : '') + '</li>';
  };
  const parts = [];
  if (lead) parts.push('<p class="nd-b-lead"><b>The story</b> <span>' + nb(esc(lead.head)) + '</span></p>');
  if (B.results && B.results.length) parts.push('<div class="nd-b-part"><b>Results</b><ul>' + B.results.slice(0, 5).map(x => row(x, 'nd-b-res')).join('') + '</ul></div>');
  if (B.watch && B.watch.length) parts.push('<div class="nd-b-part"><b>To watch</b><ul>' + B.watch.map(x => row(x, 'nd-b-watch')).join('') + '</ul></div>');
  if (B.milestones && B.milestones.length) parts.push('<div class="nd-b-part"><b>Milestones</b><ul>' + B.milestones.map(x => row(x, 'nd-b-ms')).join('') + '</ul></div>');
  if (!parts.length) return '';
  return '<div class="nd-brief" data-i18n-ctx="newsdesk">' + parts.join('') + '<p class="nd-b-end">That is the day in the league.</p></div>';
}

/* ------------------------------------------------------------ the coverage plan --- */
const club = (b, id) => (b.clubs && b.clubs[id] && b.clubs[id].name) || 'A club';
function slateHTML(b, o) {
  const s = (b.coverage && b.coverage.slate) || [];
  if (!s.length) return '';
  return '<div class="nd-slate" data-i18n-ctx="newsdesk">' + s.map(x => {
    const h = safeHref(o.base, 'game/?g=' + x.game);
    const meter = Math.max(4, Math.min(100, Math.round(x.stakes / 1.6 * 100)));
    const side = (t, home) => '<div class="nd-sl-side"><b translate="no">' + esc(club(b, t.id)) + '</b>' +
      '<span>' + esc([t.rank ? ordShort(t.rank) : null, t.rec, t.streak].filter(Boolean).join(' · ')) + '</span>' +
      (t.form ? '<span class="nd-form" translate="no">' + esc(t.form.split('').join(' ')) + '</span>' : '') +
      (t.watch ? '<span class="nd-watch">watch: <i translate="no">' + esc(t.watch.name) + '</i>, ' + esc(t.watch.line) + '</span>' : '') + '</div>';
    const ex = x.expect ? '<span>the season’s numbers: <i translate="no">' + esc(club(b, x.expect.favourite)) + '</i> by about ' + esc(Math.abs(x.expect.margin).toFixed(1)) + '</span>' : '';
    /* the facet it turns on is in the angle above; this row is the figures */
    const met = x.meetings ? '<span>meetings this season: ' + esc(x.meetings.winsHome + '–' + x.meetings.winsAway) + '</span>' : '';
    const fans = x.fans ? '<span>fans: ' + esc(x.fans.home + '% ' + club(b, x.home.id)) + ' (' + esc(x.fans.n) + ' picks)</span>' : '';
    return '<div class="nd-sl">' +
      '<div class="nd-sl-when"><span>' + esc(x.day || '') + '</span><span class="nd-meter" title="what is at stake"><i style="width:' + meter + '%"></i></span></div>' +
      '<div class="nd-sl-teams">' + side(x.home, true) + '<span class="nd-v">v</span>' + side(x.away, false) + '</div>' +
      (x.angle ? '<p class="nd-sl-angle">' + nb(esc(x.angle)) + '</p>' : '') +
      /* the running storylines it touches (narrative.js threadsOf) */
      ((x.threads || []).length ? '<ul class="nd-sl-threads">' + x.threads.map(t => '<li>' + nb(esc(t.line)) + '</li>').join('') + '</ul>' : '') +
      '<div class="nd-sl-facts">' + [ex, met, fans].filter(Boolean).join('') + '</div>' +
      '<div class="nd-sl-plan"><b>Cover it with</b> <span>' + esc((x.plan || []).join(' · ')) + '</span>' + (h ? ' <a href="' + esc(h) + '">the game ↗</a>' : '') + '</div>' +
    '</div>';
  }).join('') + '</div>';
}
/* a club's record against its points, said as a sentence: "1.2 wins more than their points say", "one win fewer" */
function luckLine(v) {
  const a = Math.abs(v), w = a === 1 ? 'one win' : (Number.isInteger(a) ? a : a.toFixed(1)) + ' wins';
  return w + (v > 0 ? ' more' : ' fewer') + ' than their points say';
}
function ordShort(n) { const v = Math.round(+n), t = v % 100; return v + (t >= 11 && t <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th')); }

function coverageHTML(build, o) {
  const opts = Object.assign({ base: '' }, o || {});
  const C = build && build.coverage;
  if (!C) return '';
  const sec = (id, title, note, inner) => (inner ? '<div class="nd-cov" id="' + id + '"><div class="nd-cov-h"><h3>' + title + '</h3>' + (note ? '<p>' + note + '</p>' : '') + '</div>' + inner + '</div>' : '');
  const byId = new Map(build.stories.map(s => [s.id, s]));
  const big = (C.bigPicture || []).length ? '<div class="nd-big">' + C.bigPicture.map(p => '<p>' + nb(esc(p)) + '</p>').join('') + '</div>' : '';
  const lines = (C.storylines || []).map(id => byId.get(id)).filter(Boolean);
  const radar = (C.underRadar || []).map(id => byId.get(id)).filter(Boolean);
  const recaps = (C.recaps || []).length ? '<ol class="nd-recaps">' + C.recaps.map(r => {
    const h = safeHref(opts.base, 'game/?g=' + r.game);
    return '<li><a href="' + esc(h || '#') + '">' + nb(esc(r.headline)) + '</a>' + (r.standfirst ? '<small>' + esc(r.standfirst) + '</small>' : '') +
      (r.angle ? '<span class="nd-angle">' + esc(r.angle) + '</span>' : '') +
      (r.reasons && r.reasons.length ? '<span class="nd-angle">' + esc(r.reasons.join(' · ')) + '</span>' : '') +
      ((r.video || r.report) ? '<span class="nd-links">' + (r.report ? '<a href="' + esc(safeHref(opts.base, r.report) || '#') + '">the match report</a>' : '') +
        (r.video ? '<a href="' + esc(safeHref(opts.base, 'watch/?g=' + r.game) || '#') + '">the highlights</a>' : '') + '</span>' : '') + '</li>';
  }).join('') + '</ol>' : '';
  /* WHAT HAS BEEN WRITTEN, and what has not: the fortnight's pieces from creators and the news, each with the
     storylines it covers; and the storylines nobody has written about yet */
  const written = (C.written || []).length ? '<ul class="nd-people">' + C.written.map(w => {
    const h = safeHref(opts.base, w.href);
    const about = (w.stories || []).map(id => byId.get(id)).filter(Boolean).map(s => s.head);
    return '<li>' + (h ? '<a href="' + esc(h) + '" translate="no">' + esc(w.title) + '</a>' : '<span translate="no">' + esc(w.title) + '</span>') +
      ' <small>' + esc(PIECE[w.kind] || PIECE.news) + '</small>' + (about.length ? '<span class="nd-angle">' + esc(about.join(' · ')) + '</span>' : '') + '</li>';
  }).join('') + '</ul>' : '';
  const gaps = (C.gaps || []).map(id => byId.get(id)).filter(Boolean);
  const gapList = gaps.length ? '<ul class="nd-people">' + gaps.map(s => '<li><b>' + nb(esc(s.head)) + '</b>' + (s.dek ? '<small>' + nb(esc(s.dek)) + '</small>' : '') +
    ((s.angles || [])[0] ? '<span class="nd-angle">' + esc(s.angles[0]) + '</span>' : '') + '</li>').join('') + '</ul>' : '';
  const people = (C.players || []).length ? '<ul class="nd-people">' + C.players.map(p => '<li><b>' + nb(esc(p.head)) + '</b>' + (p.dek ? '<small>' + nb(esc(p.dek)) + '</small>' : '') +
    (p.angle ? '<span class="nd-angle">' + esc(p.angle) + '</span>' : '') + '</li>').join('') + '</ul>' : '';
  const clubs = (C.teams || []).length ? '<div class="nd-clubs">' + C.teams.map(t => '<div class="nd-club"><b translate="no">' + esc(t.name) + '</b>' +
    '<span>' + esc([t.rank ? ordShort(t.rank) : null, t.rec].filter(Boolean).join(' · ')) + '</span>' +
    (t.form ? '<span class="nd-form" translate="no">' + esc(t.form.split('').join(' ')) + '</span>' : '') +
    (t.identity ? '<span>' + esc(t.identity) + '</span>' : '') +
    (t.luck != null && Math.abs(t.luck) >= 1 ? '<span>' + esc(luckLine(t.luck)) + '</span>' : '') +
    '<span>' + esc('close games ' + t.close) + '</span>' + (t.next ? '<span>' + esc('next: ' + t.next) + '</span>' : '') + '</div>').join('') + '</div>' : '';
  const notes = (C.notes || []).length ? '<dl class="nd-notes">' + C.notes.map(n => '<div><dt>' + esc(n.head) + '</dt><dd>' + nb(esc(n.line)) + '</dd></div>').join('') + '</dl>' : '';
  /* the award races as they stand: the site's own season awards, the leader and the number each is decided on */
  const awards = (C.awards || []).length ? '<dl class="nd-notes nd-awards">' + C.awards.map(a => {
    const who = a.who ? (a.player ? '<a href="' + esc(safeHref(opts.base, 'p/?p=' + a.player) || '#') + '" translate="no">' + esc(a.who) + '</a>' : '<span translate="no">' + esc(a.who) + '</span>') : '';
    const club = a.club ? '<span translate="no">' + esc(a.club) + '</span>' : '';
    return '<div><dt>' + esc(a.label) + '</dt><dd>' + (who ? who + (club ? ', ' + club : '') : club) +
      (a.value != null ? ' <small>' + esc(String(a.value)) + (a.detail ? ' · ' + esc(a.detail) : '') + '</small>' : '') + (a.chosen ? ' <small>chosen by the league</small>' : '') + '</dd></div>';
  }).join('') + '</dl>' : '';
  const cal = (C.calendar || []).length ? '<div class="nd-cal">' + C.calendar.map(d => '<div class="nd-day"><b>' + esc(d.day) + '</b><ul>' +
    d.items.map(i => '<li data-kind="' + esc(i.kind) + '">' + esc(i.what) + '</li>').join('') + '</ul></div>').join('') + '</div>' : '';
  return '<div class="nd-plan" data-i18n-ctx="newsdesk">' +
    sec('ndBig', 'The big picture', 'The state of the league, and what wins in it', big) +
    sec('ndBrief', 'Today', 'The day in the league, to read in a minute', briefingHTML(build, opts)) +
    sec('ndLines', 'The storylines to run', 'Ranked by how much each matters now; each with its evidence, the counterpoint and ways to cover it',
      lines.length ? '<div class="nd-grid wide">' + lines.map(s => storyHTML(s, Object.assign({}, opts, { full: true, actions: !!opts.write }))).join('') + '</div>' : '') +
    sec('ndGaps', 'Not yet covered', 'Storylines nobody has written about in the last fortnight: the openings', gapList) +
    sec('ndRadar', 'Under the radar', 'What the numbers say that the table does not', radar.length ? '<div class="nd-grid">' + radar.map(s => storyHTML(s, Object.assign({}, opts, { actions: !!opts.write }))).join('') + '</div>' : '') +
    sec('ndSlate', 'The week ahead', 'Every game in the next seven days, the biggest first, with the angle a preview should take', slateHTML(build, opts)) +
    sec('ndRecaps', 'Recaps worth writing', 'The week’s games, the most worth a piece first', recaps) +
    sec('ndPeople', 'Players to feature', null, people) +
    sec('ndClubs', 'Clubs to feature', 'What wins for them, the record against the points, the close games and what is next', clubs) +
    sec('ndAwards', 'The award races', 'The season’s awards as they stand, by the site’s own measures', awards) +
    sec('ndWritten', 'Already written', 'The last fortnight’s pieces about the league, and the storylines each one covers', written) +
    sec('ndNotes', 'Data notes', null, notes) +
    sec('ndCal', 'The week’s calendar', 'What to publish, and when', cal) +
  '</div>';
}

/* the whole plan as text, to paste into a document */
function planText(b) {
  if (!b || !b.coverage) return '';
  const C = b.coverage, byId = new Map(b.stories.map(s => [s.id, s]));
  const out = [(b.league ? b.league.name : '') + ' — coverage plan, ' + new Date(b.built).toDateString(), ''];
  if (C.bigPicture.length) out.push('THE BIG PICTURE', ...C.bigPicture, '');
  if (b.briefing && b.briefing.lines.length) out.push('TODAY', ...b.briefing.lines, '');
  const lines = (C.storylines || []).map(id => byId.get(id)).filter(Boolean);
  if (lines.length) { out.push('THE STORYLINES'); lines.forEach((s, i) => out.push((i + 1) + '. ' + s.copy.replace(/\n/g, '\n   ') + (s.angles && s.angles.length ? '\n   Ways to cover it: ' + s.angles.join('; ') : ''), '')); }
  const gaps = (C.gaps || []).map(id => byId.get(id)).filter(Boolean);
  if (gaps.length) { out.push('NOT YET COVERED'); gaps.forEach(s => out.push('- ' + s.head)); out.push(''); }
  if ((C.slate || []).length) { out.push('THE WEEK AHEAD'); C.slate.forEach(x => out.push('- ' + x.day + ': ' + x.title + (x.angle ? ' — ' + x.angle : '') + ' — ' + (x.plan || []).join(', '))); out.push(''); }
  if ((C.recaps || []).length) { out.push('RECAPS WORTH WRITING'); C.recaps.forEach(r => out.push('- ' + r.headline + (r.angle ? ' (' + r.angle + ')' : '') + (r.reasons && r.reasons.length ? ' [' + r.reasons.join('; ') + ']' : ''))); out.push(''); }
  if ((C.written || []).length) { out.push('ALREADY WRITTEN'); C.written.forEach(w => out.push('- ' + w.title)); out.push(''); }
  if ((C.awards || []).length) { out.push('THE AWARD RACES'); C.awards.forEach(a => out.push('- ' + a.label + ': ' + [a.who, a.club].filter(Boolean).join(', ') + (a.value != null ? ' (' + a.value + (a.detail ? ', ' + a.detail : '') + ')' : ''))); out.push(''); }
  if ((C.notes || []).length) { out.push('DATA NOTES'); C.notes.forEach(n => out.push('- ' + n.head + ': ' + n.line)); out.push(''); }
  if ((C.calendar || []).length) { out.push('THE CALENDAR'); C.calendar.forEach(d => out.push('- ' + d.day + ': ' + d.items.map(i => i.what).join(' / '))); }
  return out.join('\n').trim();
}

return { load, seen, markSeen, storiesHTML, storyHTML, briefingHTML, coverageHTML, planText, badgeOf, ago, safeHref };
}));
