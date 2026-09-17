/* ============================================================================
   icsfeed — a club's or a league's fixtures as an iCalendar feed (RFC 5545), built
   apart from the request so supabase/tests/ics.test.mjs can hold it to the standard
   under Node. The ics Edge Function reads the rows and calls buildCalendar.

   WHAT EVERY CALENDAR APP NEEDS, AND WHY EACH LINE IS HERE (docs/calendar.md):

     CRLF and folding      RFC 5545 §3.1: lines end CRLF and are at most 75 OCTETS,
                           continued after a space. Counted in bytes, so an accented
                           club name or the en dash in a score cannot split a
                           character in half.
     UTC stamps            every DTSTART/DTEND ends in Z, so there is no VTIMEZONE to
                           agree about: a phone in any time zone shows the right local
                           time, and British Summer Time is Britain's problem, not the
                           feed's.
     a stable UID          the game's id: a refetch updates the event it already has
                           instead of adding a second one.
     a stable DTSTAMP      the row's own last change, not "now". The body is then
                           byte-identical between changes, so the ETag holds and a
                           client's conditional fetch costs nothing.
     STATUS                CONFIRMED, or CANCELLED for a voided game, so a subscriber
                           sees it struck through rather than silently vanishing.
     TRANSP:TRANSPARENT    a fixture is something to know about, not an appointment:
                           it must not make a fan look busy to their colleagues.
     no empty properties   a game with no venue has no LOCATION line at all. An empty
                           value is legal and still upsets older parsers.
     X-WR-* and RFC 7986   X-WR-CALNAME is what Google, Apple and Outlook actually read
                           for the calendar's name; NAME and DESCRIPTION are the
                           standard's newer spelling of the same thing, for clients
                           that prefer them. Both are given.
     REFRESH-INTERVAL      how often a client should re-read: every client decides for
                           itself in the end (Google takes up to a day), but Apple and
                           Outlook honour it.
   ============================================================================ */

export const PRODID = '-//Epinoia//Fixtures//EN';
/* how often a subscribed client is asked to look again */
export const REFRESH = 'PT6H';
/* a fixture with no final score is two hours long: about a basketball game with its warm-up */
export const DEFAULT_MINUTES = 120;

const enc = new TextEncoder();

/* RFC 5545 §3.3.11: a backslash, semicolon, comma and newline carry meaning in a text
   value, so each is escaped. Anything else (including the en dash in a score) is text. */
export function escText(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/* RFC 5545 §3.1: at most 75 octets a line, continued on the next after one space. */
export function foldLine(line) {
  const out = [];
  let cur = '', bytes = 0, limit = 75;
  for (const ch of String(line)) {              // by code point: a surrogate pair stays whole
    const n = enc.encode(ch).length;
    if (bytes + n > limit) { out.push(cur); cur = ' '; bytes = 1; limit = 75; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

/* 20260919T173000Z, the only date form every client reads the same way */
export function stampUTC(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/* The moment this row last changed, as far as the database can say: when it was
   finalised, reverted or created. Never "now", so the feed's bytes only move when
   something about the game does. */
export function changedAt(game) {
  const times = [game.finalised_at, game.reverted_at, game.created_at]
    .map(t => (t ? Date.parse(t) : NaN))
    .filter(t => Number.isFinite(t));
  const tip = game.tipoff_at ? Date.parse(game.tipoff_at) : NaN;
  if (!times.length) return Number.isFinite(tip) ? new Date(tip) : new Date(0);
  return new Date(Math.max(...times));
}

const name = (side, fallback) => (side && (side.name || side.short_name)) || fallback;

/* One VEVENT's lines, or [] for a game with no tip-off time to put it at. */
export function eventLines(game, opts) {
  const o = opts || {};
  if (!game || !game.tipoff_at) return [];
  const start = new Date(game.tipoff_at);
  if (Number.isNaN(start.getTime())) return [];
  const minutes = Number(o.minutes) > 0 ? Number(o.minutes) : DEFAULT_MINUTES;
  const done = game.status === 'final' || game.status === 'finalising';
  const off = game.status === 'void';
  const home = name(game.home, 'Home'), away = name(game.away, 'Away');
  const score = done && game.home_score != null && game.away_score != null
    ? `${home} ${game.home_score}–${game.away_score} ${away}` : '';
  const title = (off ? 'Cancelled: ' : '') + (score || `${home} v ${away}`);
  const link = o.site ? String(o.site).replace(/\/?$/, '/') + 'game/?g=' + game.id + '&mode=supabase' : '';
  const where = [game.venue, game.venue_address].filter(Boolean).join(', ');
  const comp = game.competitions && game.competitions.name ? game.competitions.name : '';
  const body = [comp, off ? 'This game is off.' : done ? 'Final score.' : '', link ? 'Box score, stats and video: ' + link : '']
    .filter(Boolean).join('\n');
  const changed = stampUTC(changedAt(game));

  const lines = [
    'BEGIN:VEVENT',
    'UID:' + game.id + '@epinoia',
    'DTSTAMP:' + changed,
    'DTSTART:' + stampUTC(start),
    'DTEND:' + stampUTC(new Date(start.getTime() + minutes * 60000)),
    foldLine('SUMMARY:' + escText(title))
  ];
  if (body) lines.push(foldLine('DESCRIPTION:' + escText(body)));
  if (where) lines.push(foldLine('LOCATION:' + escText(where)));
  if (link) lines.push(foldLine('URL:' + link));
  lines.push('STATUS:' + (off ? 'CANCELLED' : 'CONFIRMED'));
  /* a fixture should not make its fan look busy */
  lines.push('TRANSP:TRANSPARENT');
  lines.push('LAST-MODIFIED:' + changed);
  lines.push('CATEGORIES:Basketball');
  lines.push('END:VEVENT');
  return lines;
}

/* The whole calendar. games: the rows, in the order they should appear. */
export function buildCalendar(opts) {
  const o = opts || {};
  const title = String(o.name || 'EPINOIΛ');
  const desc = o.description || (title + ' fixtures and results from EPINOIΛ. It updates itself: a moved tip-off, a new round or a final score arrives on its own.');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:' + PRODID,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    foldLine('X-WR-CALNAME:' + escText(title)),
    foldLine('NAME:' + escText(title)),
    foldLine('X-WR-CALDESC:' + escText(desc)),
    foldLine('DESCRIPTION:' + escText(desc)),
    'X-WR-TIMEZONE:Europe/London',
    'REFRESH-INTERVAL;VALUE=DURATION:' + REFRESH,
    'X-PUBLISHED-TTL:' + REFRESH
  ];
  for (const g of (o.games || [])) lines.push(...eventLines(g, o));
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/* A short, stable tag for a body: the same bytes always give the same tag, and any
   change gives another. FNV-1a over the UTF-8 bytes, with the length beside it. */
export function etagFor(text) {
  const bytes = enc.encode(String(text));
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return '"' + bytes.length.toString(36) + '-' + h.toString(16).padStart(8, '0') + '"';
}

/* A file name a phone, a Mac and a Windows PC will all accept, and that says what it is. */
export function fileName(title) {
  const base = String(title || 'fixtures')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 _-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'fixtures';
  return base + '.ics';
}

/* The response headers. download: the browser saves the file instead of the page trying
   to show it — the way into a calendar app that cannot subscribe to a URL (Samsung
   Calendar, the stock Android one). */
export function feedHeaders(opts) {
  const o = opts || {};
  return {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': (o.download ? 'attachment' : 'inline') + '; filename="' + fileName(o.name) + '"',
    /* half an hour at a shared cache; a client that asks again gets 304 from the ETag */
    'Cache-Control': 'public, max-age=1800',
    ETag: etagFor(o.body || ''),
    'X-Content-Type-Options': 'nosniff'
  };
}

/* Does the caller already hold this exact body? RFC 9110 If-None-Match, including the
   weak form a proxy may add and a list of tags. */
export function etagMatches(header, tag) {
  if (!header || !tag) return false;
  if (header.trim() === '*') return true;
  const want = tag.replace(/^W\//, '');
  return header.split(',').some(part => part.trim().replace(/^W\//, '') === want);
}
