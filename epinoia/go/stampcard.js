'use strict';
/* ============================================================================
   A STAMP AS A CARD (EPINOIA GO, migration 0177) - the feed's stamps, drawn like the find-a-game cards:
   the home club's colour into the away club's, both crests, the home crest as a watermark, the teams big,
   the day and hour and the arena under them.

   One builder for every place a fan's stamp is shown to others: the feed on the GO home page, the wall,
   and - later - a public profile. It takes a row of go_feed() (kind 'stamp') and returns one link.

   A stamp of a game that was removed later has no clubs: the card is the arena and the day.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaGoStampCard = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

/* ---------------------------------------------------------------- pure --- */

const colourOf = c => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : null);

function zoneOk(tz) {
  if (!tz) return false;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return true; } catch (_) { return false; }
}

/* The day and hour of a tip-off on the clock of the league it was played in (the fan reading it may be anywhere).
   The year only when it is not this one; no hour when the feed has none (midnight is a game whose hour was never
   set). `iso` missing or not a date: nothing. */
function whenText(iso, tz, locale, now) {
  const ms = Date.parse(iso);
  if (!isFinite(ms)) return { day: '', time: '' };
  const zone = zoneOk(tz) ? tz : undefined;
  const year = t => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric' }).format(t);
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
  const opts = { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short' };
  if (year(ms) !== year(now == null ? Date.now() : now)) opts.year = 'numeric';
  return {
    day: new Intl.DateTimeFormat(locale, opts).format(ms),
    time: clock === '00:00' ? '' : new Intl.DateTimeFormat(locale, { timeZone: zone, hour: '2-digit', minute: '2-digit' }).format(ms),
  };
}

/* a club as epinoiaCrest reads it, from a feed row's flat columns */
function teamOf(row, side) {
  return { name: row[side] || '', short_name: row[side + '_short'] || '', colour: row[side + '_colour'] || null,
           logo_path: row[side + '_logo'] || null };
}

/* ---------------------------------------------------------------- page --- */

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const data = (t, c, x) => { const n = el(t, c, x); n.setAttribute('translate', 'no'); return n; };

function crestOf(team) {
  if (typeof window !== 'undefined' && window.epinoiaCrest) return window.epinoiaCrest(team);
  return data('span', 'ep-crest', String(team.short_name || team.name || '?').slice(0, 3));
}

/* o.href      where the card goes (a fan's page)
   o.onOpen    called instead of following the link, when the page keeps its own place (the wall)
   o.cls       more classes for the page's own layout */
function build(row, o) {
  const opt = o || {};
  const loc = (typeof window !== 'undefined' && window.EpinoiaI18n && window.EpinoiaI18n.locale) || undefined;
  const home = teamOf(row, 'home'), away = teamOf(row, 'away');
  const teams = !!(row.home || row.away);
  const a = el('a', 'sc' + (opt.cls ? ' ' + opt.cls : ''));
  a.href = opt.href || '#';
  const c1 = colourOf(home.colour), c2 = colourOf(away.colour);
  if (c1) a.style.setProperty('--c1', c1);
  if (c2) a.style.setProperty('--c2', c2);
  if (teams) {
    const mark = a.appendChild(el('span', 'sc-mark'));
    mark.setAttribute('aria-hidden', 'true');
    mark.appendChild(crestOf(home));
    const crests = a.appendChild(el('span', 'sc-crests'));
    [home, away].forEach(t => crests.appendChild(el('span', 'sc-crest')).appendChild(crestOf(t)));
  }
  const body = a.appendChild(el('span', 'sc-body'));
  const k = body.appendChild(el('span', 'sc-k'));
  k.appendChild(el('span', null, 'stamped by'));
  k.appendChild(document.createTextNode(' '));
  k.appendChild(data('b', null, '@' + (row.username || '')));
  body.appendChild(data('span', 'sc-title', teams ? (row.home || '—') + ' v ' + (row.away || '—') : (row.venue || '—')));
  const w = whenText(row.tipoff_at || row.created_at, row.tz, loc);
  if (w.day) {
    const when = body.appendChild(el('span', 'sc-when'));
    when.appendChild(data('span', 'sc-day', w.day));
    if (w.time && row.tipoff_at) when.appendChild(data('time', 'sc-time', w.time)).dateTime = row.tipoff_at;
  }
  const meta = teams ? [row.venue, row.city].filter(Boolean).join(' · ') : [row.city, row.league].filter(Boolean).join(' · ');
  if (meta) body.appendChild(data('span', 'sc-meta', meta));
  if (opt.onOpen) a.addEventListener('click', ev => { ev.preventDefault(); opt.onOpen(row); });
  return a;
}

return { build, whenText, teamOf, colourOf };
}));
