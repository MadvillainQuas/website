/* ============================================================================
   The fixtures calendar: the feed (supabase/functions/_shared/icsfeed.js, served by the
   ics function) and the panel that adds it to a calendar (epinoia/calendar.js).
   Contract: docs/calendar.md.

   What fails quietly without these checks:
     * a line over 75 octets, or one folded inside a multi-byte character, which turns a
       club's name into mojibake in Outlook and can make Google reject the feed;
     * a comma or semicolon in a venue unescaped, which silently cuts the value short;
     * a local time with no zone, so a fixture lands an hour out over British Summer Time;
     * a UID that moves, which makes every refresh duplicate the season;
     * DTSTAMP set to "now", which changes the body on every fetch and makes the ETag, and
       every conditional refresh, worthless;
     * an empty LOCATION or DESCRIPTION line, which older parsers refuse;
     * a voided game vanishing instead of showing as cancelled;
     * the panel offering an Android phone the Google route, which adds a calendar that
       Samsung Calendar can never see — the bug this was written for;
     * the download link losing ?download=1, so the file opens as text instead of saving.

   Run: node supabase/tests/ics.test.mjs
   ============================================================================ */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
  buildCalendar, eventLines, escText, foldLine, stampUTC, changedAt, etagFor, etagMatches,
  feedHeaders, fileName, PRODID, DEFAULT_MINUTES
} from '../functions/_shared/icsfeed.js';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '\n          ' + detail : '')); }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want),
  'got  ' + JSON.stringify(got) + '\n          want ' + JSON.stringify(want));

/* the calendar as a client reads it: folded lines joined back together (RFC 5545 §3.1) */
const unfold = text => String(text).replace(/\r\n[ \t]/g, '');

const SITE = 'https://prophesyscouting.co.uk/epinoia/';
const G1 = '4218c8e7-89d4-4f53-8615-668083684226';
const G2 = '2c32dc2b-b389-4303-94a9-25c5ec87381e';
const game = (o = {}) => Object.assign({
  id: G1,
  tipoff_at: '2026-09-27T15:00:00+00:00',
  status: 'scheduled',
  venue: 'Canon Medical Arena',
  venue_address: 'Attercliffe, Sheffield',
  home_score: 0, away_score: 0,
  created_at: '2026-08-01T09:00:00+00:00',
  home: { name: 'B. Braun Sheffield Sharks' },
  away: { name: 'Caledonia Gladiators' },
  competitions: { name: 'Championship 26-27' }
}, o);

/* ------------------------------------------------------------------ the feed --- */
console.log('\nthe feed: RFC 5545, as every calendar reads it');
{
  const body = buildCalendar({ name: 'B. Braun Sheffield Sharks · EPINOIΛ', games: [game()], site: SITE });
  const raw = body;
  const lines = raw.split('\r\n');
  ok('every line ends CRLF and the file does too', raw.endsWith('END:VCALENDAR\r\n') && !/[^\r]\n/.test(raw));
  ok('it opens and closes a VCALENDAR', lines[0] === 'BEGIN:VCALENDAR' && lines[lines.length - 2] === 'END:VCALENDAR');
  ok('version, product, scale and method', lines.includes('VERSION:2.0') && lines.includes('PRODID:' + PRODID)
     && lines.includes('CALSCALE:GREGORIAN') && lines.includes('METHOD:PUBLISH'));
  ok('the name Google, Apple and Outlook read, and the standard\'s newer spelling',
     raw.includes('X-WR-CALNAME:B. Braun Sheffield Sharks · EPINOIΛ') && raw.includes('\r\nNAME:B. Braun'));
  ok('a refresh interval, in both spellings', raw.includes('REFRESH-INTERVAL;VALUE=DURATION:PT6H') && raw.includes('X-PUBLISHED-TTL:PT6H'));
  ok('no line is over 75 octets', lines.every(l => Buffer.byteLength(l, 'utf8') <= 75),
     lines.filter(l => Buffer.byteLength(l, 'utf8') > 75).join(' | '));
  const flat = unfold(raw);
  ok('unfolded, every line is a PROPERTY:value', flat.split('\r\n').filter(Boolean).every(l => /^[A-Z][A-Z0-9-]*(;[^:]+)?:/.test(l)),
     flat.split('\r\n').filter(Boolean).find(l => !/^[A-Z][A-Z0-9-]*(;[^:]+)?:/.test(l)));

  const ev = flat.slice(flat.indexOf('BEGIN:VEVENT'));
  ok('the event is stamped, timed and titled',
     ev.includes('UID:' + G1 + '@epinoia') && ev.includes('DTSTART:20260927T150000Z') && ev.includes('DTEND:20260927T170000Z')
     && ev.includes('SUMMARY:B. Braun Sheffield Sharks v Caledonia Gladiators'));
  ok('...in UTC, so no client has to agree about a time zone', !/DTSTART(;[^:]*)?:\d{8}T\d{6}(?!Z)/.test(ev));
  ok('...at the venue, with the address', ev.includes('LOCATION:Canon Medical Arena\\, Attercliffe\\, Sheffield'));
  ok('...linking the game page', ev.includes('URL:' + SITE + 'game/?g=' + G1 + '&mode=supabase'));
  ok('...confirmed, and free rather than busy', ev.includes('STATUS:CONFIRMED') && ev.includes('TRANSP:TRANSPARENT'));
  ok('...with the competition in the description', ev.includes('DESCRIPTION:Championship 26-27\\n'));
  eq('the event is two hours long by default', DEFAULT_MINUTES, 120);
}
{
  const final = game({ status: 'final', home_score: 88, away_score: 81, finalised_at: '2026-09-27T17:05:00Z' });
  const raw = unfold(buildCalendar({ name: 'x', games: [final], site: SITE }));
  ok('a finished game carries the score, with an en dash', raw.includes('SUMMARY:B. Braun Sheffield Sharks 88–81 Caledonia Gladiators'));
  ok('...and says so in the description', raw.includes('Final score.'));
  ok('...stamped when it was finalised, not now', raw.includes('DTSTAMP:20260927T170500Z') && raw.includes('LAST-MODIFIED:20260927T170500Z'));
}
{
  const off = game({ status: 'void' });
  const raw = unfold(buildCalendar({ name: 'x', games: [off], site: SITE }));
  ok('a voided game stays, cancelled, rather than vanishing', raw.includes('STATUS:CANCELLED') && raw.includes('SUMMARY:Cancelled: B. Braun'));
}
{
  const bare = { id: G2, tipoff_at: '2026-10-11T19:30:00Z', status: 'scheduled', created_at: '2026-08-01T09:00:00Z' };
  const raw = unfold(buildCalendar({ name: 'x', games: [bare], site: '' }));
  ok('a game with no venue has no LOCATION line at all', !/\r\nLOCATION:/.test(raw), raw);
  ok('...and no link means no URL or DESCRIPTION line', !/\r\nURL:/.test(raw) && !/\r\nDESCRIPTION:[^\r\n]/.test(raw.slice(raw.indexOf('BEGIN:VEVENT'))));
  ok('...and the sides are still named', raw.includes('SUMMARY:Home v Away'));
  eq('a game with no tip-off is not an event', eventLines({ id: 'x', status: 'scheduled' }, {}), []);
  eq('...nor is one with an unreadable date', eventLines({ id: 'x', tipoff_at: 'soon' }, {}), []);
}
{
  /* the bytes must not move between changes, or every fetch looks like a change */
  const rows = [game(), game({ id: G2, tipoff_at: '2026-10-11T19:30:00Z' })];
  const a = buildCalendar({ name: 'x', games: rows, site: SITE });
  const b = buildCalendar({ name: 'x', games: rows, site: SITE });
  ok('two builds of the same fixtures are byte-identical', a === b);
  eq('...so the ETag holds', etagFor(a), etagFor(b));
  const moved = buildCalendar({ name: 'x', games: [game({ tipoff_at: '2026-09-27T16:00:00Z' }), rows[1]], site: SITE });
  ok('a moved tip-off changes both', moved !== a && etagFor(moved) !== etagFor(a));
  ok('the ETag is quoted', /^"[0-9a-z]+-[0-9a-f]{8}"$/.test(etagFor(a)), etagFor(a));
  ok('If-None-Match matches its own tag, the weak form, a list and *',
     etagMatches(etagFor(a), etagFor(a)) && etagMatches('W/' + etagFor(a), etagFor(a))
     && etagMatches('"other", ' + etagFor(a), etagFor(a)) && etagMatches('*', etagFor(a)));
  ok('...and not another', !etagMatches('"nope"', etagFor(a)) && !etagMatches('', etagFor(a)));
}
{
  /* folding is counted in octets, and never inside a character */
  const long = 'Wolverhampton Wanderers Basketball Club Under Nineteens Academy — second string';
  const folded = foldLine('SUMMARY:' + escText(long + ' éééé – – –'));
  const parts = folded.split('\r\n');
  ok('a long line folds', parts.length > 1);
  ok('...each piece within 75 octets', parts.every(p => Buffer.byteLength(p, 'utf8') <= 75), parts.map(p => Buffer.byteLength(p, 'utf8')).join());
  ok('...continuations are marked by a leading space', parts.slice(1).every(p => p.startsWith(' ')));
  ok('...and unfolding gives the text back', parts.map((p, i) => (i ? p.slice(1) : p)).join('') === 'SUMMARY:' + escText(long + ' éééé – – –'));
  ok('no character is cut in half', !/�/.test(Buffer.from(folded, 'utf8').toString('utf8')));
  const emoji = foldLine('SUMMARY:' + 'x'.repeat(70) + '\u{1F3C0}\u{1F3C0}');
  ok('a surrogate pair stays whole', emoji.split('\r\n').every(p => Buffer.byteLength(p, 'utf8') <= 75) && emoji.includes('\u{1F3C0}'));
}
{
  eq('a backslash, semicolon, comma and newline are escaped', escText('a\\b;c,d\ne'), 'a\\\\b\\;c\\,d\\ne');
  eq('a carriage return is a newline too', escText('a\r\nb'), 'a\\nb');
  eq('nothing else is touched', escText('Nottingham Hoods – café'), 'Nottingham Hoods – café');
  eq('null is empty', escText(null), '');
  eq('a date becomes a UTC stamp', stampUTC('2026-09-27T15:00:00+01:00'), '20260927T140000Z');
  eq('an unreadable date is nothing', stampUTC('never'), '');
  eq('the change time prefers finalised, then reverted, then created',
     [changedAt(game({ finalised_at: '2026-09-27T17:05:00Z' })).toISOString(), changedAt(game()).toISOString()],
     ['2026-09-27T17:05:00.000Z', '2026-08-01T09:00:00.000Z']);
}
{
  const body = buildCalendar({ name: 'x', games: [game()], site: SITE });
  const h = feedHeaders({ name: 'B. Braun Sheffield Sharks', body });
  eq('the type every client expects', h['Content-Type'], 'text/calendar; charset=utf-8');
  ok('a file name every operating system accepts: plain characters, ending .ics',
     /^inline; filename="[A-Za-z0-9 _-]+\.ics"$/.test(h['Content-Disposition']) && /Sheffield Sharks/.test(h['Content-Disposition']),
     h['Content-Disposition']);
  ok('download sends it as a file to save', feedHeaders({ name: 'x', body, download: true })['Content-Disposition'].startsWith('attachment;'));
  ok('cached for half an hour, with a tag to ask again with', /max-age=1800/.test(h['Cache-Control']) && !!h.ETag);
  eq('a name of nothing but punctuation still makes a file name', fileName('···'), 'fixtures.ics');
  ok('a very long name is cut', fileName('x'.repeat(200)).length <= 64);
}

/* ------------------------------------------------------------- the function --- */
console.log('\nthe ics function: what it serves, and to whom');
{
  const fn = read('supabase', 'functions', 'ics', 'index.ts');
  ok('it builds the feed with the shared module', /from '\.\.\/_shared\/icsfeed\.js'/.test(fn) && /buildCalendar\(/.test(fn));
  ok('a club by slug or id, a league by slug, from the path or the query',
     /\\\/ics\\\/\(team\|league\)/.test(fn) && /searchParams\.get\('team'\)/.test(fn) && /searchParams\.get\('league'\)/.test(fn));
  ok('void games are served too (as cancelled)', /'scheduled', 'live', 'finalising', 'final', 'void'/.test(fn));
  ok('it answers 304 when the caller already has these bytes', /etagMatches\(req\.headers\.get\('if-none-match'\)/.test(fn) && /status: 304/.test(fn));
  ok('HEAD is answered without a body', /req\.method === 'HEAD' \? null : body/.test(fn));
  ok('?download=1 sends it as a file', /download = url\.searchParams\.get\('download'\) === '1'/.test(fn));
  ok('anyone may read it: no auth, and CORS for a browser', /Access-Control-Allow-Origin': '\*'/.test(fn) && !/Authorization/.test(fn));
  ok('the ETag and the file name are readable cross-origin', /Access-Control-Expose-Headers': 'ETag, Content-Disposition'/.test(fn));
  ok('the file is named after the club, not the calendar\'s "· EPINOIΛ" title', /feedHeaders\(\{ name, body, download \}\)/.test(fn));
  const cfg = read('supabase', 'config.toml');
  ok('deployed without a JWT gate (a calendar client sends no headers)', /\[functions\.ics\]\s*\nverify_jwt = false/.test(cfg));
}

/* ----------------------------------------------------------------- the panel --- */
console.log('\nthe panel: the right route for the device in hand');
const C = require(path.join(ROOT, 'epinoia', 'calendar.js'));
const URL_ICS = 'https://ref.supabase.co/functions/v1/ics/team/sharks.ics';
{
  const ua = {
    iphone: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 },
    ipadDesktop: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 },
    samsung: { userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' },
    mac: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 0 },
    windows: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36', platform: 'Win32' }
  };
  eq('an iPhone is an iPhone', C.platform(ua.iphone), 'ios');
  eq('an iPad asking for the desktop site is too', C.platform(ua.ipadDesktop), 'ios');
  eq('a Samsung phone is Android', C.platform(ua.samsung), 'android');
  eq('a Mac is a Mac', C.platform(ua.mac), 'mac');
  eq('anything else is a desktop', C.platform(ua.windows), 'desktop');

  const ids = p => C.routes(p, URL_ICS, 'Sharks').map(r => r.id);
  eq('an iPhone is offered Apple first', ids('ios')[0], 'apple');
  eq('an Android phone is offered the Android route first, then the file', ids('android').slice(0, 2), ['android', 'file']);
  eq('a desktop is offered Google first', ids('desktop')[0], 'google');
  ok('every device is offered all four routes', ['ios', 'android', 'mac', 'desktop'].every(p => ids(p).length === 4 && new Set(ids(p)).size === 4));

  const android = C.routes('android', URL_ICS, 'Sharks')[0];
  ok('the Android route names Samsung Calendar and what it cannot do', /Samsung Calendar/.test(android.how) && /cannot follow a calendar link/.test(android.how));
  ok('...and leads with installing ICSx⁵, because Subscribe has nothing to open before that',
     android.action.href === C.ICSX5 && /^1\. Get ICSx/.test(android.action.label) && /^2\. Subscribe/.test(android.extra.label));
  ok('...from F-Droid, where it is free, rather than the paid Play listing',
     C.ICSX5 === 'https://f-droid.org/packages/at.bitfire.icsdroid/' && /F‑Droid/.test(android.action.label));
  ok('...Subscribe is an Android intent naming ICSx⁵, with the store as its fallback, so a phone without it lands on the store rather than a blank screen',
     android.extra.href.startsWith('intent://ref.supabase.co/functions/v1/ics/team/sharks.ics#Intent;')
     && android.extra.href.includes(';scheme=webcal;') && android.extra.href.includes(';package=at.bitfire.icsdroid;')
     && android.extra.href.includes('S.browser_fallback_url=' + encodeURIComponent(C.ICSX5)) && android.extra.href.endsWith(';end'),
     android.extra.href);
  ok('...Google Play is still offered for anybody who would rather pay the developer',
     android.links.some(l => l.href === C.ICSX5_PLAY) && /£1\.79 on Google Play/.test(android.how));
  ok('...and F-Droid is named as the shop, not the app (the mistake this row exists to prevent)',
     /F-Droid itself is only the shop/.test(android.note));
  ok('...and the words say to install first', /Install ICSx⁵ first/.test(android.how) && /nothing to open/.test(android.how));
  const google = C.routes('android', URL_ICS, 'Sharks').find(r => r.id === 'google');
  ok('the Google route warns that a phone calendar app will not see it', /not in Samsung Calendar or other phone calendar apps/.test(google.how));
  const file = C.routes('ios', URL_ICS, 'Sharks').find(r => r.id === 'file');
  ok('the file route says it does not update', /does not update/.test(file.how) && file.action.href.endsWith('?download=1'));
  eq('webcal is the https feed by another name', C.webcalOf(URL_ICS), URL_ICS.replace('https:', 'webcal:'));
  eq('download keeps an existing query string', C.downloadOf('https://x/y.ics?team=a'), 'https://x/y.ics?team=a&download=1');
  ok('the Google and Outlook routes open the screens that still work',
     C.GOOGLE_ADD === 'https://calendar.google.com/calendar/r/settings/addbyurl' && C.OUTLOOK_ADD.startsWith('https://outlook.live.com/calendar/'));
}
{
  /* the panel, drawn into a fake document */
  class El {
    constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.parent = null; this.attrs = {}; this.dataset = {};
      this.className = ''; this.ownText = ''; this.hidden = false; this.listeners = {}; this.style = {}; }
    get textContent() { return this.ownText + this.children.map(c => c.textContent).join(''); }
    set textContent(v) { this.children = []; this.ownText = v == null ? '' : String(v); }
    append(...ns) { ns.forEach(n => this.appendChild(n)); }
    appendChild(n) { n.parent = this; this.children.push(n); return n; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
    click() { (this.listeners.click || []).forEach(f => f({})); }
    focus() { this.focused = true; }
    select() { this.selected = true; }
    all() { return this.children.flatMap(c => [c, ...c.all()]); }
  }
  const byClass = (root, c) => root.all().filter(n => String(n.className).split(/\s+/).includes(c));
  const head = new El('head');
  const doc = { createElement: t => new El(t), getElementById: id => (id === 'ep-cal-css' && doc._css ? doc._css : null), head, documentElement: head };
  const host = new El('div');
  const copied = [];
  const navigator = { userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) Mobile Safari/537.36', platform: 'Linux armv8l',
                      clipboard: { writeText: t => { copied.push(t); return Promise.resolve(); } } };
  const out = C.mount(host, { url: URL_ICS, name: 'B. Braun Sheffield Sharks', document: doc, navigator });
  ok('it draws a chip and a panel', !!out && out.chip.tagName === 'BUTTON' && byClass(host, 'ep-cal').length === 1);
  ok('the panel starts closed, and the chip says so', out.panel.hidden === true && out.chip.getAttribute('aria-expanded') === 'false');
  out.chip.click();
  ok('...and the chip opens it', out.panel.hidden === false && out.chip.getAttribute('aria-expanded') === 'true');
  const rows = byClass(out.panel, 'ep-cal-r');
  eq('one row per route, Android first on an Android phone', rows.map(r => r.dataset.route), ['android', 'file', 'google', 'outlook']);
  ok('the club is named at the top', out.panel.textContent.includes('B. Braun Sheffield Sharks in your calendar'));
  const links = byClass(out.panel, 'ep-cal-go').filter(n => n.tagName === 'A');
  ok('on an Android phone the subscribe link is the intent, and the download link is a download',
     links.some(a => a.href && a.href.startsWith('intent://') && a.href.includes('package=at.bitfire.icsdroid')) &&
     links.some(a => a.href && a.href.endsWith('download=1') && 'download' in a.attrs),
     links.map(a => a.href).join(' | '));
  ok('...and the intent stays in this tab, where its fallback can land', links.filter(a => String(a.href).startsWith('intent://')).every(a => !a.target));
  ok('links out open in a new tab, safely', links.filter(a => a.target).every(a => a.target === '_blank' && a.rel === 'noopener'));
  ok('an iPhone still gets a plain webcal: link', C.routes('ios', URL_ICS, 'Sharks')[0].action.href.startsWith('webcal:'));
  const field = out.panel.all().find(n => String(n.className).includes('ep-cal-url'));
  eq('the address is there to copy by hand', field.value, URL_ICS);
  ok('...read-only, and labelled', field.readOnly === true && /calendar address/.test(field.getAttribute('aria-label')));
  byClass(out.panel, 'ep-cal-copy')[0].click();
  eq('the copy button copies the feed address', copied, [URL_ICS]);
  const style = head.children.find(n => n.tagName === 'STYLE');
  ok('its styles are injected once, under an id', style && style.id === 'ep-cal-css' && /\.ep-cal\{/.test(style.textContent)
     && head.children.filter(n => n.tagName === 'STYLE').length === 1);
  out.hide();
  ok('closing hides it again', out.panel.hidden === true && out.chip.getAttribute('aria-expanded') === 'false');
}
{
  const team = read('epinoia', 't', 'team.js');
  ok('the team page mounts the panel with the club\'s own feed',
     /EpinoiaCalendar\.mount\(acts, \{ url: ics, name: team\.name \}\)/.test(team) && /'\/functions\/v1\/ics\/team\/'/.test(team));
  ok('...and no longer hand-rolls the Google steps', !/addbyurl/.test(team));
  const page = read('epinoia', 't', 'index.html');
  ok('the page loads calendar.js before team.js', /calendar\.js\?v=\d+/.test(page) && page.indexOf('calendar.js') < page.indexOf('team.js?'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
