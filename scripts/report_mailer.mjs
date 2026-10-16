/* ============================================================================
   REPORTS BY EMAIL (0221; .github/workflows/report-mail.yml, every half hour).

   For every active row of report_mail_subs (an address, a club, a time zone, set in the platform console):
     GAME      each of the club's games finalised since the address was added (and in the last week), not yet sent:
               the game analysis PDF from the club's side (game/analysis.js), one email a game, as soon as it is final,
               with the club's next fixture
     SUNDAY    once on Sunday from 8 am at the address's own time (SUNDAY_FROM_MIN) - or, when an opponent of the week ahead plays that
               Sunday, an hour after its game is final (sundayHold; stops waiting at 23:30): the club reports (t/ Report tab) of every opponent
               the club plays in the week ahead, Monday to Sunday at that time (so a Sunday game is in the email the
               Sunday before it, never in two), and every other Sunday the club's own report too, all in ONE email.
               An address's first Sunday also takes in any game later that day. A Sunday with neither sends nothing.
   report_mail_log keeps what went (a row a game, a row a Sunday), so a rerun never sends twice.
   WHAT GOES (0263, Louie 2026-10-14): each address has its kinds (send_games, send_opponents, send_own, and 0228's player_zip),
               ticked in the reports manager; a week can be picked too (report_mail_picks: an opponent left out, the own report
               forced or held back, the players' ZIP on or off for that Sunday), and "send now" carries its own ticks
               (report_mail_requests.pick). Before 0263 every kind goes, as before.
   NOTHING IS MISSED (2026-10-14): a Sunday email that did not go on its Sunday (a late game held it past midnight, the
               half-hourly run did not come) goes on the Monday or Tuesday after (catchUpWeek), for what is still to play of
               that week, dated by that Sunday so it is never sent twice; one game whose analysis cannot be drawn no longer
               stops the rest of an address's emails (it is given up 36 hours after it was final, logged as not sent); the
               fortnight of the club's own report is counted in Sundays, not hours; an address's first Sunday does not wait
               for that day's own game; and a Sunday whose email carries the club's own report waits for the club's own game
               that day too. A zone that cannot be read falls back to the league's, then UTC.
   SEND NEXT WEEK'S REPORTS NOW (0226): a platform administrator can ask, in the console, for the SUNDAY email at once, for one
               address or every active one (report_mail_requests). Taken first in each run, for the Monday-to-Sunday
               that begins next Monday at the address's own time; it counts as that Sunday's email (it logs the Sunday
               before the week), so the Sunday round finds it done and sends nothing twice.

   THE PLAYERS' REPORTS (0228): right after a Sunday email (or a "send now" one), a reply to it - "Re:" its subject, threaded
               under it (In-Reply-To / References its Message-ID, which the mailer sets) - with the player report of every
               player of each club whose report went in it, one ZIP a club: everyone who has played for the club this
               season, leaving out the players it has released (player_releases) and those under 10 minutes a game. An
               address's player_zip turns it off (the reports manager). A player's report is drawn once a run.

   The PDFs are the site's own: a headless Chromium opens the page served from this checkout (SITE, a local server the
   workflow starts), presses the report's own "Download PDF" and takes the file. EPINOIA_RP_BOT, set before the page's
   scripts run, opens the members' report for the member it is bought for, and draws it at email weight (report.js).
   PRIMED FOR SENDING (0229): a report PRIME REPORT kept (primed_reports, bucket 'primed') is sent as it was primed, in place of
   one drawn here, while no game of its club has been finalised since; it is deleted once the run has emailed it.
   SYNERGY AND RAPM (0228): every report is PRIMED first (EPINOIA_RP_PRIME, report.js prime: RAPM read from report_rapm or
   worked out), with the Synergy numbers the admins kept (synergy_profiles, read with the service key) handed to the page
   (EPINOIA_SYNERGY); RAPM a page had to work out is kept in report_rapm, so the next report of that league and season,
   in this run or any other, reads it. Before 0228 is applied neither is there, and the reports are drawn as before.
   An email that would still pass Resend's size limit goes as parts ("part 1 of 2"), each whole. Every report is also
   kept for the PROFILE dashboard of the account it went to (0225, keep()).

   env: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, REPORTS_FROM ("Epinoia <reports@...>"), SITE (default
        http://127.0.0.1:8765), PUBLIC_SITE (the dashboard link; default https://prophesyscouting.co.uk), DRY=1 (build and log nothing, send nothing: prints what it would do), ONLY=<email>
   The helpers below are exported (supabase/tests/report-mailer.test.mjs); the run starts only when this is the script.
   ============================================================================ */
import { pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const env = process.env;
const SITE = (env.SITE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const DRY = env.DRY === '1' || env.DRY === 'true';
const FROM = env.REPORTS_FROM || 'Epinoia <onboarding@resend.dev>';
/* the public site, for the link to the dashboard where every report is kept too (0225) */
const PUBLIC = (env.PUBLIC_SITE || 'https://prophesyscouting.co.uk').replace(/\/$/, '');
/* Resend takes 40 MB an email, attachments base64-encoded; parts stay under this */
export const MAX_EMAIL_BYTES = 34e6;

/* ------------------------------------------------------------------ the database --- */
const H = () => ({ apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json' });
async function rest(path, opt = {}) {
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/' + path, { ...opt, headers: { ...H(), ...(opt.headers || {}) } });
  if (!r.ok) throw new Error(r.status + ' on ' + path.split('?')[0] + ': ' + (await r.text()).slice(0, 300));
  if (r.status === 204) return null;
  /* an insert that does not ask for the row back answers 201 with nothing in it (PostgREST's return=minimal) */
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}
const log = async (sub, kind, ref, detail) => {
  if (DRY) return;
  /* on_conflict names the (sub, kind, ref) key: a row already there (a "send now" again for a week already sent) is skipped, not a 409
     that would stop the email's players' ZIP (2026-10-04). Tried three times: an email that went and was not logged goes again. */
  for (let i = 0; ; i++) {
    try { return await rest('report_mail_log?on_conflict=sub_id,kind,ref', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify({ sub_id: sub.id, kind, ref, detail: detail || null }) }); }
    catch (e) { if (i >= 2) throw e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
  }
};

/* ------------------------------------------------------------------ time in the reader's zone --- */
/* the Sunday email goes from this many minutes after midnight at the address's own time: 8 am (9 am until 4 Oct 2026) */
export const SUNDAY_FROM_MIN = 8 * 60;
const partsOf = (tz, d) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    second: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second, wd: p.weekday };
};
export const local = (tz, d = new Date()) => { const p = partsOf(tz, d); return { date: p.y + '-' + String(p.mo).padStart(2, '0') + '-' + String(p.d).padStart(2, '0'), hour: p.h, mi: p.mi, wd: p.wd }; };
/* how far the zone is ahead of UTC at an instant, and the instant a local midnight falls on (twice round, for a
   midnight that a clock change moves) */
const offsetAt = (ms, tz) => { const p = partsOf(tz, new Date(ms)); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000; };
const midnight = (y, mo, d, tz) => { const g = Date.UTC(y, mo - 1, d); return g - offsetAt(g - offsetAt(g, tz), tz); };
/* THE WEEK AHEAD of a Sunday: Monday 00:00 to the next Monday 00:00 at the reader's time; an address's first Sunday
   starts now, so a game later that day is not missed */
export function weekAhead(tz, now = new Date(), first = false) {
  const p = partsOf(tz, now), base = Date.UTC(p.y, p.mo - 1, p.d);
  const at = days => { const x = new Date(base + days * 864e5); return midnight(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate(), tz); };
  return { from: new Date(first ? now.getTime() : at(1)), to: new Date(at(8)) };
}
/* NEXT WEEK, asked for on any day: the Monday-to-Sunday that begins at the next Monday (tomorrow, on a Sunday), at the
   reader's time. `sunday` is the date of the day before it: the Sunday whose email this is, which that Sunday's own
   round looks for in the log. On a Sunday it is weekAhead's week. (The console draws the same range: platform.js weekWords.) */
export function nextWeek(tz, now = new Date()) {
  const p = partsOf(tz, now), base = Date.UTC(p.y, p.mo - 1, p.d);
  const k = (8 - new Date(base).getUTCDay()) % 7 || 7;                    // days to the next Monday: from Sunday 1, from Monday 7
  const at = days => { const x = new Date(base + days * 864e5); return midnight(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate(), tz); };
  return { from: new Date(at(k)), to: new Date(at(k + 7)), sunday: new Date(base + (k - 1) * 864e5).toISOString().slice(0, 10) };
}
/* AN OPPONENT PLAYING ON THE SUNDAY ITSELF: the scouting report on a club that plays that very day is worth more after the game than
   before it, so the Sunday email waits for it - until an hour after the last of those games is final (SUNDAY_AFTER_MS), and no longer
   than SUNDAY_CUTOFF_MIN of the Sunday (a game that never finalises must not keep the week's email back for ever). `games`: the
   opponents' games of that Sunday ({ status, finalised_at }); `cutoff`: the instant to stop waiting. Answers { wait, why }. */
export const SUNDAY_AFTER_MS = 36e5;
export const SUNDAY_CUTOFF_MIN = 23 * 60 + 30;
/* a game still "scheduled" or "live" this long after its tip-off is one the feed lost (or never started): it is not waited for */
export const SUNDAY_STALE_MS = 5 * 36e5;
export function sundayHold(games, now, cutoff) {
  if (now.getTime() >= cutoff.getTime()) return { wait: false, why: 'past the cut-off' };
  const open = games.filter(g => (g.status === 'scheduled' || g.status === 'live') && !(g.tipoff_at && now.getTime() - Date.parse(g.tipoff_at) > SUNDAY_STALE_MS));
  if (open.length) return { wait: true, why: open.length + ' game(s) still to finish' };
  const ends = games.filter(g => g.status === 'final' && g.finalised_at).map(g => Date.parse(g.finalised_at));
  const last = ends.length ? Math.max.apply(null, ends) : 0;
  if (last && now.getTime() < last + SUNDAY_AFTER_MS) return { wait: true, why: 'an hour after the last game, ' + new Date(last + SUNDAY_AFTER_MS).toISOString() };
  return { wait: false, why: games.length ? 'an hour after the last game' : 'no opponent plays today' };
}
/* the instant the Sunday's waiting stops: SUNDAY_CUTOFF_MIN after that day's local midnight */
export function sundayCutoff(tz, now = new Date()) {
  const [y, mo, d] = local(tz, now).date.split('-').map(Number);
  return new Date(midnight(y, mo, d, tz) + SUNDAY_CUTOFF_MIN * 6e4);
}
export function sundayBounds(tz, now = new Date()) {
  const [y, mo, d] = local(tz, now).date.split('-').map(Number), g = new Date(Date.UTC(y, mo - 1, d + 1));
  return { from: new Date(midnight(y, mo, d, tz)), to: new Date(midnight(g.getUTCFullYear(), g.getUTCMonth() + 1, g.getUTCDate(), tz)) };
}
const dayName = (iso, tz) => new Date(iso).toLocaleDateString('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' });
const dayShort = (iso, tz) => new Date(iso).toLocaleDateString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' });
const timeOf = (iso, tz) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' });

/* a time zone that can be read, else the next one that can (a mistyped zone must not stop an address for good) */
export function okZone(...zones) {
  for (const z of zones) { if (!z) continue; try { new Intl.DateTimeFormat('en-GB', { timeZone: z }); return z; } catch (_) { /* the next */ } }
  return 'UTC';
}
/* WHAT A WEEK'S EMAIL CARRIES (0263): the address's kinds (send_opponents, send_own, player_zip; missing = on), then a pick
   ({ opps: [ids] the only opponents to send, skip: [ids] to leave out, own: true / false / null, players: true / false / null }),
   from "send now"'s ticks or the week's own (report_mail_picks). An opponent ticked by hand goes even when the kind is off; own: true
   sends the club's own report even when its fortnight is not up. */
export function weekChoice({ sub, opps, ownDue, pick }) {
  const P = pick || {}, S = sub || {};
  let use = S.send_opponents === false ? [] : opps.slice();
  if (Array.isArray(P.opps)) { const want = new Set(P.opps.map(String)); use = opps.filter(o => want.has(String(o.oid))); }
  if (Array.isArray(P.skip)) { const no = new Set(P.skip.map(String)); use = use.filter(o => !no.has(String(o.oid))); }
  const own = P.own === true ? true : P.own === false ? false : (S.send_own !== false && !!ownDue);
  /* the ZIP is 0228's: an address read before it (no such column) has none, as then */
  const players = P.players === true ? true : P.players === false ? false : 'player_zip' in S && S.player_zip !== false;
  return { opps: use, own, players };
}
/* THE CLUB'S OWN REPORT IS DUE every other Sunday: two Sundays since the last one went (its log row's ref is the Sunday it went
   for), whatever hour it went at, so a report sent late on its Sunday or caught up on the Monday does not push the next a week on */
export function ownDueOn(log, day) {
  const days = (log || []).filter(x => x.kind === 'team' && /^\d{4}-\d{2}-\d{2}$/.test(x.ref || '')).map(x => Date.parse(x.ref + 'T00:00:00Z'));
  if (!days.length) return true;
  return Date.parse(day + 'T00:00:00Z') - Math.max.apply(null, days) >= 13 * 864e5;
}
/* A SUNDAY THAT WAS MISSED: on the Monday or Tuesday after it, at the address's time, when that Sunday has no email in the log and
   the address was there by that Sunday's 8 am. Answers { day: that Sunday, W: its week ahead } or null. */
export const CATCH_UP_DAYS = 2;
export function catchUpWeek(tz, now, sub, sent) {
  const p = partsOf(tz, now), base = Date.UTC(p.y, p.mo - 1, p.d), dow = new Date(base).getUTCDay();   // 0 Sunday .. 6 Saturday
  if (dow === 0 || dow > CATCH_UP_DAYS) return null;
  const sun = new Date(base - dow * 864e5), day = sun.toISOString().slice(0, 10);
  if ((sent || []).some(x => x.kind === 'sunday' && x.ref === day)) return null;
  const sunMid = midnight(sun.getUTCFullYear(), sun.getUTCMonth() + 1, sun.getUTCDate(), tz);
  if (sub && sub.created_at && Date.parse(sub.created_at) > sunMid + SUNDAY_FROM_MIN * 6e4) return null;
  return { day, W: weekAhead(tz, new Date(sunMid + 12 * 36e5)) };
}

/* ------------------------------------------------------------------ words --- */
const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const possessive = n => String(n) + (/s$/i.test(String(n)) ? '’' : '’s');
export const listOf = a => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/* a club's colour as ink on white (report.js inkOn): darkened until it reads at 4.5:1 */
function inkOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return '#08603f';
  const n = parseInt(m[1], 16), c = [n >> 16 & 255, n >> 8 & 255, n & 255];
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = x => 0.2126 * lin(x[0]) + 0.7152 * lin(x[1]) + 0.0722 * lin(x[2]);
  for (let t = 0; t <= 1.0001; t += 0.05) { const x = c.map(v => Math.round(v * (1 - t))); if (1.05 / (L(x) + 0.05) >= 4.5) return '#' + x.map(v => v.toString(16).padStart(2, '0')).join(''); }
  return '#0d1f17';
}
const colourOf = team => (/^#[0-9a-f]{6}$/i.test((team && team.colour) || '') ? team.colour : '#08603f');

/* ------------------------------------------------------------------ the email's dress --- */
/* AN EMAIL, BUILT AS EMAIL IS: tables, inline styles, one column of 600px. The Epinoia bar, a band in the club's
   colour, the kind of email and its headline, then the letter; the attachments named; why it came and how to stop it */
const F = 'font-family:Arial,Helvetica,sans-serif;';
export function layout({ colour, kicker, title, meta, greeting, blocks, files, kept = true, foot }) {
  const ink = inkOn(colour);
  const fileRows = (files || []).map(f => '<tr><td style="padding:7px 0;border-top:1px solid #e4ebe7;' + F + 'font-size:14px;color:#0d1f17">' +
    '<span style="display:inline-block;padding:2px 6px;margin-right:8px;border-radius:4px;background:' + ink + ';color:#ffffff;font-size:10px;font-weight:bold;letter-spacing:.06em">' + esc(f.kind || 'PDF') + '</span>' +
    esc(f.label) + '</td></tr>').join('');
  return '<!doctype html><html><body style="margin:0;padding:0;background:#eef2ef">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2ef"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden">' +
      '<tr><td style="background:#0d1f17;padding:18px 28px;' + F + 'font-size:15px;font-weight:bold;letter-spacing:.32em;color:#ffffff">EPINOIA</td></tr>' +
      '<tr><td style="height:6px;line-height:6px;font-size:0;background:' + colour + '">&nbsp;</td></tr>' +
      '<tr><td style="padding:26px 28px 6px">' +
        '<div style="' + F + 'font-size:11px;font-weight:bold;letter-spacing:.16em;text-transform:uppercase;color:' + ink + '">' + esc(kicker) + '</div>' +
        '<div style="' + F + 'font-size:24px;font-weight:bold;line-height:1.25;color:#0d1f17;margin-top:6px">' + esc(title) + '</div>' +
        (meta ? '<div style="' + F + 'font-size:14px;color:#5b6b63;margin-top:6px">' + esc(meta) + '</div>' : '') +
      '</td></tr>' +
      '<tr><td style="padding:14px 28px 4px;' + F + 'font-size:15px;line-height:1.6;color:#0d1f17">' +
        '<p style="margin:0 0 14px">' + esc(greeting) + '</p>' + blocks.join('') +
        '<p style="margin:18px 0 0">Kind regards,<br>The Epinoia team</p>' +
      '</td></tr>' +
      (fileRows ? '<tr><td style="padding:18px 28px 6px"><div style="' + F + 'font-size:11px;font-weight:bold;letter-spacing:.14em;text-transform:uppercase;color:#5b6b63;margin-bottom:4px">Attached</div>' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + fileRows + '</table></td></tr>' : '') +
      '<tr><td style="padding:18px 28px 24px;' + F + 'font-size:12px;line-height:1.5;color:#7a8a82;border-top:1px solid #e4ebe7">' +
        /* foot: an email's own why-and-how-to-stop (a player's weekly report, 0272), in place of the clubs' */
        (foot ? esc(foot) : ((kept ? 'Every report is also kept in your <a href="' + PUBLIC + '/epinoia/profile/#reports" style="color:#0d1f17;font-weight:bold">Epinoia dashboard</a>, to open or download again: sign in with this address. '
              : 'The club reports are kept in your <a href="' + PUBLIC + '/epinoia/profile/#reports" style="color:#0d1f17;font-weight:bold">Epinoia dashboard</a> (sign in with this address); these player reports come in this email. ') +
        'You receive these because your club’s reports were set up for this address on Epinoia. To change or stop them, simply reply to this email and let us know.')) +
      '</td></tr>' +
    '</table></td></tr></table></body></html>';
}
const P = html => '<p style="margin:0 0 14px">' + html + '</p>';
const UL = items => '<ul style="margin:0 0 14px;padding-left:20px">' + items.map(i => '<li style="margin:0 0 4px">' + i + '</li>').join('') + '</ul>';
const NOTE = (ink, html) => '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 16px"><tr><td style="padding:12px 14px;border-left:4px solid ' + ink +
  ';background:#f4f8f6;' + F + 'font-size:14px;line-height:1.5;color:#0d1f17">' + html + '</td></tr></table>';
const FIXTURES = (rows, tz) => '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:2px 0 16px;border:1px solid #e4ebe7;border-radius:8px">' +
  rows.map((o, i) => '<tr><td style="padding:9px 12px;' + (i ? 'border-top:1px solid #e4ebe7;' : '') + F + 'font-size:14px;color:#0d1f17;white-space:nowrap"><b>' + esc(dayShort(o.g.tipoff_at, tz)) + '</b> · ' + esc(timeOf(o.g.tipoff_at, tz)) + '</td>' +
    '<td style="padding:9px 12px;' + (i ? 'border-top:1px solid #e4ebe7;' : '') + F + 'font-size:14px;color:#0d1f17">' + (o.home ? 'v ' : 'at ') + '<b>' + esc(o.oname) + '</b>' +
      '<div style="font-size:12px;color:#5b6b63">' + (o.home ? 'Home' : 'Away') + (o.g.venue ? ' · ' + esc(o.g.venue) : '') + '</div></td></tr>').join('') + '</table>';

/* ------------------------------------------------------------------ the emails --- */
/* AFTER A GAME: the result, what the analysis holds, the next fixture */
export function gameEmail({ sub, team, g, side, next, tz }) {
  const club = team.name, colour = colourOf(team), ink = inkOn(colour);
  const us = side ? g.away_score : g.home_score, them = side ? g.home_score : g.away_score;
  const opp = ((side ? g.home : g.away) || {}).name || 'the opposition';
  const lg = (((g.competitions || {}).seasons || {}).leagues || {}).name || (g.competitions || {}).name || '';
  const won = us > them, lost = us < them;
  const when = g.tipoff_at ? dayName(g.tipoff_at, tz) : '';
  const home = (g.home || {}).name || '', away = (g.away || {}).name || '';
  const subject = `Game analysis: ${club} ${us}–${them} ${opp}${lg ? ' (' + lg + ')' : ''}`;
  const blocks = [
    P(`Please find attached the game analysis for ${esc(possessive(club))} ${us}–${them} ${won ? 'win over' : lost ? 'loss to' : 'game against'} ${esc(opp)}` +
      `${when ? ' on ' + esc(when) : ''}${g.venue ? ' at ' + esc(g.venue) : ''}. It covers both teams, side by side:`),
    UL(['<b>Main stats</b>: the four factors, the ratings and the margin, explained through the scoring and possession battles',
      '<b>Shot charts</b>: where each team scored from, in the half court and in transition, and what each kind of possession was worth',
      '<b>Lineups</b>: each team’s most-used fives and how they fared',
      '<b>Full stats</b>: every player of both teams, scoring, shot selection and their impact on the floor',
      '<b>Game flow</b>: the scoring runs, the rotations and how the margin moved']),
    P('Every figure is coloured against the competition’s clubs over the season, green good and red poor, and the legend at the back explains each statistic.'),
    next ? NOTE(ink, '<b>Next up:</b> ' + esc(dayName(next.tipoff_at, tz)) + ', ' + esc(timeOf(next.tipoff_at, tz)) + ' · ' +
      (next.home_team_id === team.id ? 'v ' + esc((next.away || {}).name || '') + ' at home' : 'at ' + esc((next.home || {}).name || '')) + (next.venue ? ' (' + esc(next.venue) + ')' : '')) : '',
    P(`We will send the next analysis as soon as ${esc(possessive(club))} following game is final.`)].filter(Boolean);
  return { subject, html: layout({ colour, kicker: 'Game analysis' + (lg ? ' · ' + lg : ''), title: `${home} ${g.home_score}–${g.away_score} ${away}`,
    meta: [when, g.venue].filter(Boolean).join(' · '), greeting: sub.name ? 'Hi ' + sub.name + ',' : 'Hello,', blocks,
    files: [{ label: 'Game analysis: ' + club + ' v ' + opp }] }) };
}

/* THE WEEK'S OPPONENTS: one a club, however often it is met that week, in the order they come */
export function opponentsOf(team, games) {
  const opps = games.map(g => { const home = g.home_team_id === team.id;
    return { g, oid: home ? g.away_team_id : g.home_team_id, oname: ((home ? g.away : g.home) || {}).name || 'opponent', home }; });
  return { opps, uniq: [...new Map(opps.map(o => [o.oid, o])).values()] };
}

/* SUNDAY: the week ahead and a scouting report on each opponent, the club's own every other Sunday */
/* `picked`: the opponents ticked for this email (0263), or null for all; one left unticked is in the fixtures, with no report and no word of why */
export function sundayEmail({ sub, team, games, ownDue, tz, monday, noReport, picked }) {
  const club = team.name, colour = colourOf(team), ink = inkOn(colour);
  const { opps, uniq: every } = opponentsOf(team, games);
  const none = new Set(noReport || []), on = picked ? new Set(picked) : null;
  const uniq = every.filter(o => !none.has(o.oid) && (!on || on.has(o.oid))), without = every.filter(o => none.has(o.oid));
  const noneLine = without.length ? P(`No scouting report on ${esc(listOf(without.map(o => o.oname)))} yet: ${without.length > 1 ? 'they have' : 'they have'} not played a game this season.`) : '';
  const n = uniq.length, k = opps.length;
  const files = uniq.map(o => ({ label: 'Scouting report: ' + o.oname })).concat(ownDue ? [{ label: 'Team report: ' + club + ' (fortnightly)' }] : []);
  const week = monday ? new Date(monday).toLocaleDateString('en-GB', { timeZone: tz, day: 'numeric', month: 'long' }) : '';
  const inside = UL(['their four factors and season line, ranked among the competition’s clubs',
    'where they shoot from and how well, at both ends, half court and transition',
    'every player’s profile, with position-adjusted rankings',
    'their depth chart, rotations and most-used lineups']);
  if (!n) {
    return { subject: `${possessive(club)} fortnightly team report`, html: layout({ colour, kicker: 'Fortnightly team report', title: club + ': your team report',
      meta: week ? 'Week of ' + week : '', greeting: sub.name ? 'Hi ' + sub.name + ',' : 'Hello,', files, blocks: [
        k && !without.length ? P(`${esc(club)} ${k === 1 ? 'has one game' : 'have ' + (NUM[k] || k) + ' games'} in the week ahead. This email carries your fortnightly team report only: the season’s four factors and ` +
          'season line, shooting at both ends, the squad’s profiles, the depth chart and the most-used lineups, each figure coloured against the competition’s clubs.')
        : k ? P(`${esc(club)} ${k === 1 ? 'has one game' : 'have ' + (NUM[k] || k) + ' games'} in the week ahead, against ${esc(listOf(without.map(o => o.oname)))}, who ${without.length > 1 ? 'have' : 'has'} not played a game this season yet, so there is no scouting report this week. Your fortnightly team report is attached: the season’s four factors and ` +
          'season line, shooting at both ends, the squad’s profiles, the depth chart and the most-used lineups, each figure coloured against the competition’s clubs.')
          : P(`There are no games for ${esc(club)} in the week ahead, so your fortnightly team report comes on its own, attached: the season’s four factors and ` +
          'season line, shooting at both ends, the squad’s profiles, the depth chart and the most-used lineups, each figure coloured against the competition’s clubs.'),
        P('Enjoy the week, and we will be in touch as soon as the next game is on the schedule.')] }) };
  }
  const subject = `Your week ahead: scouting report${n > 1 ? 's' : ''} on ${listOf(uniq.map(o => o.oname))}${ownDue ? ', plus ' + possessive(club) + ' team report' : ''}`;
  return { subject, html: layout({ colour, kicker: 'The week ahead' + (week ? ' · from ' + week : ''), title: `${club}: ${NUM[k] || k} game${k > 1 ? 's' : ''} this week`,
    meta: 'Times are ' + tz.replace(/_/g, ' ').split('/').pop() + ' time', greeting: sub.name ? 'Hi ' + sub.name + ',' : 'Hello,', files, blocks: [
      P(`${esc(club)} ${k === 1 ? 'has one game' : 'have ' + (NUM[k] || k) + ' games'} in the week ahead:`),
      FIXTURES(opps, tz),
      P(`Attached ${n > 1 ? 'are scouting reports on ' + (n + without.length === every.length ? 'each opponent' : esc(listOf(uniq.map(o => o.oname)))) : 'is a scouting report on ' + esc(uniq[0].oname)}, so you can prepare in good time. ${n > 1 ? 'Each covers' : 'It covers'}:`),
      inside,
      noneLine,
      ownDue ? NOTE(ink, `As it is your fortnightly report week, ${esc(possessive(club))} own team report is attached too, so you can see how the season is shaping up on the same measures.`) : '',
      P('Good luck in the week ahead.')].filter(Boolean) }) };
}

/* ------------------------------------------------------------------ the PDFs and sending --- */
let browser = null;
/* a test's own drawing, in place of Chromium: hooks.pdf(path, name) answers { filename, content } */
export const hooks = { pdf: null };
/* SYNERGY FOR EVERY REPORT (0228): every profile the admins kept, { player id: profile }, read once a run with the service
   key (the table answers admins only: the data is licensed). null when it cannot be read (0228 not applied): then the
   reports are drawn as before 0228, not primed either. */
let SYN_ALL;
export async function synergyAll() {
  if (SYN_ALL !== undefined) return SYN_ALL;
  try {
    const all = {};
    for (let off = 0; ; off += 1000) {
      const rows = await rest(`synergy_profiles?select=player_id,profile&order=player_id&limit=1000&offset=${off}`);
      rows.forEach(r => { all[r.player_id] = r.profile; });
      if (rows.length < 1000) break;
    }
    SYN_ALL = all;
  } catch (e) { console.warn('Synergy and RAPM left out (0228 not applied?):', e.message || e); SYN_ALL = null; }
  return SYN_ALL;
}
/* RAPM a page worked out (report.js leaves it on window.__rpRapm), kept for the next report of that league and season */
async function keepRapm(r) {
  if (DRY || !r || !r.key || !Array.isArray(r.m) || !(r.games > 0)) return;
  try {
    await rest('report_rapm?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ key: r.key, games: r.games, m: r.m, computed_at: new Date().toISOString() }) });
  } catch (e) { console.warn('RAPM not kept (' + r.key + '):', e.message || e); }
}
/* opt.context: a browser context of the caller's (a test routes the page's calls through it) */
export async function pdfOf(path, name, opt = {}) {
  if (hooks.pdf) return hooks.pdf(path, name);
  let ctx = opt.context;
  if (!ctx) {
    if (!browser) { const { chromium } = await import('playwright'); browser = await chromium.launch(); }
    ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 }, acceptDownloads: true });
  }
  const syn = await synergyAll();
  await ctx.addInitScript(s => { window.EPINOIA_RP_BOT = true; if (s) { window.EPINOIA_RP_PRIME = true; window.EPINOIA_SYNERGY = s; } }, syn);
  const page = await ctx.newPage();
  try {
    await page.goto(SITE + path, { waitUntil: 'domcontentloaded', timeout: 120000 });
    /* built, and done priming (RAPM worked out for a league's season the first time can take minutes) */
    await page.waitForFunction(() => window.__rpBuilt > 0 && !window.__rpBusy && !window.__rpBuilding, null, { timeout: 600000 });
    await page.waitForTimeout(1500);
    await keepRapm(await page.evaluate(() => window.__rpRapm || null).catch(() => null));
    const dl = page.waitForEvent('download', { timeout: 300000 });
    await page.click('.rp-outs .ep-btn.pri');
    const d = await dl;
    const bytes = (await import('node:fs')).readFileSync(await d.path());
    return { filename: name + '.pdf', content: bytes.toString('base64') };
  } finally { if (opt.context) await page.close(); else await ctx.close(); }
}
/* the attachments in parts that each stay under the limit, in order */
export function partsOfFiles(att, max = MAX_EMAIL_BYTES) {
  const out = [];
  att.forEach(a => { const last = out[out.length - 1], size = a.content.length;
    if (last && last.size + size <= max) { last.files.push(a); last.size += size; } else out.push({ files: [a], size }); });
  return out.length ? out.map(p => p.files) : [[]];
}
/* headers: the email's own (a Message-ID to reply to, a reply's In-Reply-To / References); a second part gets a Message-ID
   of its own */
async function send(to, subject, html, attachments, headers) {
  const parts = partsOfFiles(attachments);
  for (let i = 0; i < parts.length; i++) {
    const subj = subject + (parts.length > 1 ? ` (part ${i + 1} of ${parts.length})` : '');
    if (DRY) { console.log('[dry] to', to, '|', subj, '|', parts[i].map(a => a.filename).join(', ')); continue; }
    const h = headers && Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, k === 'Message-ID' && i ? v.replace('@', '-p' + (i + 1) + '@') : v]));
    const r = await fetch('https://api.resend.com/emails', { method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject: subj, html, attachments: parts[i], ...(h ? { headers: h } : {}) }) });
    if (!r.ok) throw new Error('resend ' + r.status + ': ' + (await r.text()).slice(0, 300));
  }
}

/* ------------------------------------------------------------------ the dashboard's copy (0225) ---
   Every report sent is kept too, so the account it went to can open or download it again from its PROFILE dashboard:
   the PDF in the private 'reports' bucket at <address id>/<day>/<file>.pdf, and a row of report_files saying what it
   is. Kept before the email goes, so a report whose email fails is still there; keeping it failing never stops the
   email. A rerun writes the same path and the same row (sub, kind, ref), so nothing is doubled and an opened report
   stays opened. */
export const reportPath = (subId, day, filename) =>
  subId + '/' + String(day).slice(0, 10) + '/' + String(filename).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+/, '').slice(0, 150);
export function fileRow({ sub, kind, ref, title, subtitle, path, bytes }) {
  return { sub_id: sub.id, kind, ref: String(ref).slice(0, 120), title: String(title).slice(0, 200),
    subtitle: subtitle ? String(subtitle).slice(0, 300) : null, path, bytes: bytes == null ? null : bytes };
}
async function keep(sub, day, pdf, what) {
  if (DRY) { console.log('[dry] keep', reportPath(sub.id, day, pdf.filename), '|', what.title); return; }
  try {
    const path = reportPath(sub.id, day, pdf.filename), body = Buffer.from(pdf.content, 'base64');
    const r = await fetch(env.SUPABASE_URL + '/storage/v1/object/reports/' + path, { method: 'POST', body,
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'Content-Type': 'application/pdf', 'x-upsert': 'true' } });
    if (!r.ok) throw new Error('storage ' + r.status + ': ' + (await r.text()).slice(0, 200));
    await rest('report_files?on_conflict=sub_id,kind,ref', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(fileRow({ sub, path, bytes: body.length, ...what })) });
  } catch (e) { console.warn('[' + sub.email + '] not kept for the dashboard (' + what.title + '):', e.message || e); }
}
const shortDay = (iso, tz) => { try { return new Date(iso).toLocaleDateString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); } catch (_) { return ''; } };

/* ------------------------------------------------------------------ reports primed for sending (0229) --- */
/* PRIME REPORT keeps a report's PDF (primed_reports, the private bucket 'primed'). The mailer sends that file in place of drawing
   its own while no game of its club has been finalised since it was primed. Once an email carrying it has gone, it is deleted at
   the end of the run (so every address that needs it in that run gets it), as is one a newer game has made stale, or one older
   than two weeks. Before 0229 there is none, and every report is drawn as before. */
export const PRIMED = new Map();                     // 'kind:id' -> { path, sent, stale }
/* a run's own caches, empty again (supabase/tests: one run after another in one process) */
export function newRun() { PRIMED.clear(); PLAYER_PDF.clear(); SYN_ALL = undefined; }
const PRIMED_DAYS = 14;
const SK = () => ({ apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY });
async function primedPdf(kind, id, clubId, name) {
  try {
    const [row] = await rest(`primed_reports?kind=eq.${kind}&ref_id=eq.${id}&select=path,primed_at`);
    if (!row) return null;
    const key = kind + ':' + id;
    const newer = clubId ? await rest(`games?or=(home_team_id.eq.${clubId},away_team_id.eq.${clubId})&status=eq.final&finalised_at=gt.${encodeURIComponent(row.primed_at)}&select=id&limit=1`) : [];
    if (newer.length) { console.log('primed', key, 'is older than a game since: drawn afresh'); PRIMED.set(key, { path: row.path, stale: true }); return null; }
    const r = await fetch(env.SUPABASE_URL + '/storage/v1/object/primed/' + row.path, { headers: SK() });
    if (!r.ok) { console.warn('primed', key, 'not read (' + r.status + '): drawn afresh'); return null; }
    const bytes = Buffer.from(await r.arrayBuffer());
    if (!PRIMED.has(key)) PRIMED.set(key, { path: row.path, sent: false });
    console.log('primed', key, 'sent as primed (' + bytes.length + ' bytes)');
    return { filename: name + '.pdf', content: bytes.toString('base64'), primed: key };
  } catch (_) { return null; }
}
/* A REPORT FOR AN EMAIL: the primed copy when there is a fresh one, else drawn; `used` takes the primed keys of the email */
async function reportPdf(kind, id, clubId, path, name, used) {
  const got = await primedPdf(kind, id, clubId, name);
  if (got) { used.push(got.primed); return { filename: got.filename, content: got.content }; }
  return pdfOf(path, name);
}
const sentWith = keys => keys.forEach(k => { const s = PRIMED.get(k); if (s) s.sent = true; });
/* AT THE END OF A RUN: the primed copies emailed in it, the stale and the old, deleted (the file, then its row) */
export async function cleanPrimed(now = new Date()) {
  if (DRY) return 0;
  const gone = [...PRIMED].filter(([, x]) => x.sent || x.stale).map(([k, x]) => ({ kind: k.slice(0, k.indexOf(':')), id: k.slice(k.indexOf(':') + 1), path: x.path }));
  try {
    (await rest(`primed_reports?primed_at=lt.${new Date(now.getTime() - PRIMED_DAYS * 864e5).toISOString()}&select=kind,ref_id,path`))
      .forEach(r => { if (!gone.some(g => g.kind === r.kind && g.id === r.ref_id)) gone.push({ kind: r.kind, id: r.ref_id, path: r.path }); });
  } catch (_) { /* before 0229 */ }
  let n = 0;
  for (const g of gone) {
    try {
      await fetch(env.SUPABASE_URL + '/storage/v1/object/primed/' + g.path, { method: 'DELETE', headers: SK() });
      await rest(`primed_reports?kind=eq.${g.kind}&ref_id=eq.${g.id}`, { method: 'DELETE' });
      PRIMED.delete(g.kind + ':' + g.id); n++;
    } catch (e) { console.warn('primed copy not deleted (' + g.path + '):', e.message || e); }
  }
  return n;
}

/* ------------------------------------------------------------------ the players' reports (0228) --- */
/* A ZIP (PKWARE's APPNOTE: a local header and the data for each file, then the central directory): each file deflated,
   unless that would not make it smaller (a PDF's pages are compressed already, so most are stored), names in UTF-8 */
const CRC_T = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
export const crc32 = buf => { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
export function zipOf(files, when = new Date()) {
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  const date = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const out = [], dir = [];
  let at = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    const packed = deflateRawSync(data, { level: 9 }), deflated = packed.length < data.length, body = deflated ? packed : data, crc = crc32(data);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x0800, 6); loc.writeUInt16LE(deflated ? 8 : 0, 8);
    loc.writeUInt16LE(time, 10); loc.writeUInt16LE(date, 12); loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(body.length, 18);
    loc.writeUInt32LE(data.length, 22); loc.writeUInt16LE(name.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(deflated ? 8 : 0, 10);
    cen.writeUInt16LE(time, 12); cen.writeUInt16LE(date, 14); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(at, 42);
    out.push(loc, name, body); dir.push(cen, name);
    at += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(dir), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(at, 16);
  return Buffer.concat([...out, cd, end]);
}
/* WHOSE REPORTS GO IN: everyone who has played for the club this season (a game counts when the player was on the floor;
   rows: { pid, team, min } with min in milliseconds, as the box score keeps it), at 10 minutes a game or more over more than two games, and not
   released by it; the most minutes first */
export const MIN_MPG = 10;
/* and MORE THAN TWO GAMES for the club this season (Louie, 2026-10-04): two games is not a sample; a club with nobody past it
   sends no ZIP at all (the reply is skipped when no club has a player in it) */
export const MIN_GAMES = 3;
export function zipPlayers(rows, teamId, released, minMpg = MIN_MPG, minGames = Number(process.env.ZIP_MIN_GAMES) || MIN_GAMES) {
  const acc = new Map();
  rows.forEach(r => {
    const m = +r.min || 0;
    if (r.team !== teamId || !r.pid || m <= 0) return;
    const a = acc.get(r.pid) || { id: r.pid, games: 0, min: 0 };
    a.games++; a.min += m / 60000; acc.set(r.pid, a);
  });
  return [...acc.values()].map(a => ({ ...a, mpg: a.min / a.games }))
    .filter(a => a.mpg >= minMpg && a.games >= minGames && !(released && released.has(a.id))).sort((a, b) => b.mpg - a.mpg);
}
/* a read past PostgREST's thousand rows, a page at a time (the path carries its own order) */
async function restAll(path, page = 1000) {
  const out = [];
  for (let off = 0; ; off += page) { const rows = await rest(path + `&limit=${page}&offset=${off}`); out.push(...rows); if (rows.length < page) return out; }
}
/* HAS THE CLUB PLAYED THIS SEASON? A final game in its league's newest season (what its report shows). A club that has not is
   sent no club report, neither as an opponent nor as its own (Louie, 2026-10-04): it would be a report of nothing. */
const PLAYED = new Map();
export async function hasPlayed(teamId) {
  if (PLAYED.has(teamId)) return PLAYED.get(teamId);
  let yes = true;                                   // if it cannot be told, the report goes as before
  try {
    const [t] = await rest(`teams?id=eq.${teamId}&select=league_id`);
    if (t && t.league_id) {
      const [s] = await rest(`seasons?league_id=eq.${t.league_id}&select=id&order=starts_on.desc&limit=1`);
      const comps = s ? await rest(`competitions?season_id=eq.${s.id}&select=id`) : [];
      const g = comps.length ? await rest(`games?or=(home_team_id.eq.${teamId},away_team_id.eq.${teamId})&status=eq.final&competition_id=in.(${comps.map(c => c.id).join(',')})&select=id&limit=1`) : [];
      yes = g.length > 0;
    }
  } catch (e) { console.warn('could not tell whether', teamId, 'has played:', e.message || e); }
  PLAYED.set(teamId, yes);
  return yes;
}
/* the club's minutes this season: its league's newest season (what its report shows), the club's final games in it */
async function seasonMinutes(teamId) {
  const [t] = await rest(`teams?id=eq.${teamId}&select=league_id`);
  if (!t || !t.league_id) return [];
  const [s] = await rest(`seasons?league_id=eq.${t.league_id}&select=id&order=starts_on.desc&limit=1`);
  const comps = s ? await rest(`competitions?season_id=eq.${s.id}&select=id`) : [];
  if (!comps.length) return [];
  const games = await restAll(`games?or=(home_team_id.eq.${teamId},away_team_id.eq.${teamId})&status=eq.final&competition_id=in.(${comps.map(c => c.id).join(',')})&select=id,home_team_id,away_team_id&order=id`);
  const rows = [];
  for (let i = 0; i < games.length; i += 40) {
    const part = games.slice(i, i + 40), by = new Map(part.map(g => [g.id, g]));
    const got = await restAll(`player_game_stats?game_id=in.(${part.map(g => g.id).join(',')})&player_uuid=not.is.null&select=game_id,player_uuid,team_idx,min:stats->min&order=game_id,player_id`);
    got.forEach(r => { const g = by.get(r.game_id); if (g) rows.push({ pid: r.player_uuid, team: r.team_idx === 0 ? g.home_team_id : g.away_team_id, min: r.min }); });
  }
  return rows;
}
/* THE REPLY: under the Sunday email, one ZIP a club (in parts when one would pass the email's limit) */
export function playersEmail({ sub, team, subject, clubs }) {
  const names = clubs.map(c => c.name), n = clubs.reduce((s, c) => s + c.players.length, 0);
  const files = [];
  clubs.forEach(c => { for (let i = 0; i < (c.zips || 1); i++) files.push({ kind: 'ZIP', label: c.name + ': ' + c.players.length + ' player reports' + (c.zips > 1 ? ' (part ' + (i + 1) + ' of ' + c.zips + ')' : '') }); });
  return { subject: 'Re: ' + subject, html: layout({ colour: colourOf(team), kicker: 'Players’ reports', title: 'Every player’s report: ' + listOf(names),
    meta: n + ' player report' + (n === 1 ? '' : 's') + ', ' + (files.length === 1 ? 'in one ZIP' : 'in ' + files.length + ' ZIPs'), greeting: sub.name ? 'Hi ' + sub.name + ',' : 'Hello,', kept: false, files, blocks: [
      P(`Following this week’s reports, attached is the player report of everyone who has played for ${esc(listOf(names))} this season, ` +
        'leaving out the players a club has released, those averaging under 10 minutes a game and those with two games or fewer. Each has the season line ranked against the position, ' +
        'where and how the player scores, the defence, and the impact on the floor.'),
      ...clubs.map(c => P('<b>' + esc(c.name) + '</b>: ' + c.players.map(p => esc(p.name) + ' <span style="color:#5b6b63">(' + p.mpg.toFixed(1) + ' mpg)</span>').join(', ')))] }) };
}
export const ZIP_MAX = 24e6;                         // one ZIP's bytes: base64, it stays under the email's limit
const PLAYER_PDF = new Map();                        // a player's report, drawn once a run
const MAIL_HOST = (/@([A-Za-z0-9.-]+)>?\s*$/.exec(FROM) || [])[1] || 'epinoia.mail';
export const msgId = (sub, day) => '<sunday-' + day + '-' + Date.now().toString(36) + '.' + sub.id + '@' + MAIL_HOST + '>';
/* clubs: [{ id, name }], the clubs whose reports the Sunday email had. Answers what went, or null */
async function sendPlayers(sub, team, day, subject, mid, clubs) {
  const done = [], att = [], primedUsed = [];
  for (const c of clubs) {
    let gone = new Set();
    try { gone = new Set((await rest(`player_releases?team_id=eq.${c.id}&select=player_id`)).map(r => r.player_id)); } catch (_) { /* none kept */ }
    const picked = zipPlayers(await seasonMinutes(c.id), c.id, gone);
    if (!picked.length) { console.log('players', c.name, ': none at 10 minutes a game'); continue; }
    const named = await rest(`players?id=in.(${picked.map(p => p.id).join(',')})&select=id,first_name,last_name`);
    const nameOf = new Map(named.map(p => [p.id, ((p.first_name || '') + ' ' + (p.last_name || '')).trim()]));
    const files = [], used = new Set();
    for (const p of picked) {
      p.name = nameOf.get(p.id) || 'Player';
      if (!PLAYER_PDF.has(p.id)) {
        console.log('player', c.name, '->', p.name);
        const mine = [], pdf = await reportPdf('player', p.id, c.id, `/epinoia/p/?p=${p.id}&tab=report`, 'player-report-' + slug(p.name), mine);
        PLAYER_PDF.set(p.id, Object.assign(pdf, { primed: mine[0] || null }));
      }
      if (PLAYER_PDF.get(p.id).primed) primedUsed.push(PLAYER_PDF.get(p.id).primed);
      let fn = 'player-report-' + (slug(p.name) || 'player');
      for (let k = 2; used.has(fn); k++) fn = 'player-report-' + (slug(p.name) || 'player') + '-' + k;
      used.add(fn);
      files.push({ name: fn + '.pdf', data: Buffer.from(PLAYER_PDF.get(p.id).content, 'base64') });
    }
    const groups = [];
    let cur = [], size = 0;
    files.forEach(f => { if (cur.length && size + f.data.length > ZIP_MAX) { groups.push(cur); cur = []; size = 0; } cur.push(f); size += f.data.length; });
    if (cur.length) groups.push(cur);
    groups.forEach((g, i) => att.push({ filename: slug(c.name) + '-player-reports' + (groups.length > 1 ? '-' + (i + 1) : '') + '.zip', content: zipOf(g).toString('base64') }));
    done.push({ name: c.name, players: picked, zips: groups.length });
  }
  if (!done.length) return null;
  const E = playersEmail({ sub, team, subject, clubs: done });
  await send(sub.email, E.subject, E.html, att, mid ? { 'In-Reply-To': mid, References: mid } : null);
  sentWith(primedUsed);
  await log(sub, 'players', day, done.map(d => d.name + ': ' + d.players.length).join(', '));
  return done;
}

/* ------------------------------------------------------------------ one address --- */
const GAME_SELECT = 'id,home_team_id,away_team_id,home_score,away_score,tipoff_at,finalised_at,venue,home:home_team_id(name),away:away_team_id(name)';
export const GAME_GIVE_UP_MS = 36 * 36e5;
const mineOf = team => `or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})`;
const tzOf = (sub, team) => okZone(sub.tz, team.leagues && team.leagues.timezone);

/* THE WEEK AHEAD, SENT (on a Sunday, and for "send next week's reports now"): a scouting report on each opponent of the games of
   W (W.from to W.to) and, in the club's fortnight, its own report, in ONE email. `day` is the Sunday it counts as, which
   the log and the dashboard know it by. Answers what went ({ names, own }), or null when there was nothing to send, which
   the caller says. */
/* the week's own pick (report_mail_picks, 0263) for an address and a Sunday: { skip, own, players }, or null (none, or before 0263) */
async function weekPick(sub, day) {
  try {
    const [r] = await rest(`report_mail_picks?sub_id=eq.${sub.id}&sunday=eq.${day}&select=skip_opps,own,players`);
    return r ? { skip: r.skip_opps || [], own: r.own, players: r.players } : null;
  } catch (_) { return null; }
}
async function sendWeek(sub, team, tz, sent, W, day, given) {
  const club = team.name;
  const next = await rest(`games?${mineOf(team)}&status=in.(scheduled,live)&tipoff_at=gte.${W.from.toISOString()}&tipoff_at=lt.${W.to.toISOString()}&select=${GAME_SELECT}&order=tipoff_at.asc`);
  const pick = given || await weekPick(sub, day);
  const { uniq: all } = opponentsOf(team, next);
  /* a scouting report only on an opponent that has played this season; the game is still in the email, said to have none */
  const played = [], noReport = [];
  for (const o of all) { if (await hasPlayed(o.oid)) played.push(o); else { noReport.push(o.oid); console.log('opponent', club, '->', o.oname, ': not played this season, no report'); } }
  const choice = weekChoice({ sub, opps: played, ownDue: ownDueOn(sent, day), pick });
  const uniq = choice.opps;
  /* the club's own report only once it has played (the fortnight is not used up by a report of nothing) */
  const ownDue = choice.own && await hasPlayed(team.id);
  played.filter(o => !uniq.includes(o)).forEach(o => console.log('opponent', club, '->', o.oname, ': not ticked for this email'));
  if (!uniq.length && !ownDue) return null;
  const att = [], used = [];
  const week = 'Week of ' + shortDay(W.from.toISOString(), tz);
  for (const o of uniq) {
    console.log('opponent', club, '->', o.oname);
    const pdf = await reportPdf('team', o.oid, o.oid, `/epinoia/t/?t=${o.oid}&tab=report`, `scouting-report-${slug(o.oname)}`, used);
    const when = next.filter(g => g.home_team_id === o.oid || g.away_team_id === o.oid).map(g => shortDay(g.tipoff_at, tz)).join(', ');
    await keep(sub, day, pdf, { kind: 'opp', ref: day + ':' + o.oid, title: o.oname, subtitle: week + ' · ' + club + ' play them ' + when });
    att.push(pdf);
  }
  if (ownDue) {
    console.log('own', club);
    const pdf = await reportPdf('team', team.id, team.id, `/epinoia/t/?t=${team.id}&tab=report`, `team-report-${slug(club)}`, used);
    await keep(sub, day, pdf, { kind: 'team', ref: day, title: club, subtitle: 'Fortnightly team report · ' + shortDay(new Date().toISOString(), tz) });
    att.push(pdf);
  }
  const E = sundayEmail({ sub, team, games: next, ownDue, tz, monday: W.from, noReport, picked: uniq.map(o => o.oid) });
  const mid = msgId(sub, day);
  await send(sub.email, E.subject, E.html, att, { 'Message-ID': mid });
  sentWith(used);
  await log(sub, 'sunday', day, uniq.length + ' opponent(s)' + (ownDue ? ' + own' : ''));
  if (ownDue) await log(sub, 'team', day, 'own report');
  /* the players' reports of the clubs in it, in a reply to it (0228); the Sunday email has gone whatever becomes of it */
  let players = null;
  if (choice.players) try { players = await sendPlayers(sub, team, day, E.subject, mid, uniq.map(o => ({ id: o.oid, name: o.oname })).concat(ownDue ? [{ id: team.id, name: club }] : [])); }
  catch (e) { console.warn('[' + sub.email + '] the players’ reports were not sent:', e.message || e); }
  return { names: uniq.map(o => o.oname), own: ownDue, players: players ? players.reduce((s, c) => s + c.players.length, 0) : 0 };
}

async function one(sub, team) {
  const tz = tzOf(sub, team);
  let failed = 0;
  const sent = await rest(`report_mail_log?sub_id=eq.${sub.id}&select=kind,ref,sent_at`);
  const has = (kind, ref) => sent.some(x => x.kind === kind && x.ref === ref);
  const club = team.name;
  const mine = mineOf(team);

  /* GAME: every final since the address was added, in the last week, not sent yet; oldest first */
  const since = new Date(Math.max(Date.parse(sub.created_at), Date.now() - 7 * 864e5)).toISOString();
  /* ...AND PLAYED IN THAT WEEK (2026-10-06): a backfill finalises old games again, which gave last season's games a fresh
     finalised_at and would have mailed their analyses as if they were new. A game counts only if its tip-off is in the window
     too (a day's grace before it, for a game finalised the day after it was played). */
  const playedFrom = new Date(Date.parse(since) - 864e5).toISOString();
  const games = await rest(`games?${mine}&status=eq.final&finalised_at=gte.${since}&tipoff_at=gte.${playedFrom}&select=${GAME_SELECT},competitions(name,seasons(leagues(name)))&order=tipoff_at.asc`);
  for (const g of (sub.send_games === false ? [] : games)) {
    if (has('game', g.id)) continue;
    /* EACH GAME ON ITS OWN (2026-10-14): one that cannot be drawn does not stop the rest, nor the Sunday below; it is tried again
       each run, and given up 36 hours after it was final (logged as not sent, so it stops being tried) */
    const side = g.home_team_id === team.id ? 0 : 1;
    try {
      const [next] = await rest(`games?${mine}&status=in.(scheduled,live)&tipoff_at=gt.${encodeURIComponent(g.tipoff_at || new Date().toISOString())}&select=${GAME_SELECT}&order=tipoff_at.asc&limit=1`);
      const E = gameEmail({ sub, team, g, side, next, tz });
      const opp = ((side ? g.home : g.away) || {}).name || 'opponent';
      console.log('game', club, 'v', opp, g.id);
      const pdf = await pdfOf(`/epinoia/game/?g=${g.id}&analysis=${side}`, `game-analysis-${slug(club)}-v-${slug(opp)}-${(g.tipoff_at || '').slice(0, 10)}`);
      const comp = (g.competitions && g.competitions.name) || '';
      await keep(sub, (g.tipoff_at || new Date().toISOString()).slice(0, 10), pdf, { kind: 'game', ref: g.id, title: E.subject.replace(/^Game analysis: /, ''),
        subtitle: [comp, shortDay(g.tipoff_at, tz), g.venue].filter(Boolean).join(' · ') });
      await send(sub.email, E.subject, E.html, [pdf]);
      await log(sub, 'game', g.id, `${side ? g.away_score : g.home_score}-${side ? g.home_score : g.away_score} v ${opp}`);
    } catch (e) {
      failed++;
      console.error('[' + sub.email + '] game ' + g.id + ':', e.message || e);
      if (g.finalised_at && Date.now() - Date.parse(g.finalised_at) > GAME_GIVE_UP_MS) await log(sub, 'game', g.id, 'not sent: ' + String(e.message || e).slice(0, 120)).catch(() => {});
    }
  }

  /* A SUNDAY MISSED: the Monday or Tuesday after, what is still to play of its week, dated by that Sunday (catchUpWeek) */
  const L = local(tz);
  const late = catchUpWeek(tz, new Date(), sub, sent);
  if (late) {
    console.log('sunday', club, ': caught up for', late.day);
    if (!(await sendWeek(sub, team, tz, sent, late.W, late.day))) await log(sub, 'sunday', late.day, 'nothing this week (caught up)');
    return failed;
  }
  /* SUNDAY: from 8 am, once, at their own time; the week ahead is Monday to Sunday */
  if (L.wd !== 'Sun' || L.hour * 60 + L.mi < SUNDAY_FROM_MIN || has('sunday', L.date)) return failed;
  const first = !sent.some(x => x.kind === 'sunday');
  const W = weekAhead(tz, new Date(), first);
  /* WHO IS WAITED FOR: an opponent of the week ahead that plays today (its report is worth more after it), and the club itself
     when its own report goes in this email; the email goes an hour after the last of those games is final, not at 8 am. On an
     address's first Sunday the week takes in today, and today's opponent is not waited for: its report is for before the game. */
  const nextMon = weekAhead(tz, new Date(), false).from;
  const ahead = await rest(`games?${mine}&status=in.(scheduled,live)&tipoff_at=gte.${nextMon.toISOString()}&tipoff_at=lt.${W.to.toISOString()}&select=${GAME_SELECT}`);
  const pick = await weekPick(sub, L.date);
  /* (not on the first Sunday: the club's own game today is then one of the week's, and its opponent's report is for before it) */
  const ownToday = !first && weekChoice({ sub, opps: [], ownDue: ownDueOn(sent, L.date), pick }).own;
  const waitIds = weekChoice({ sub, opps: opponentsOf(team, ahead).uniq, ownDue: false, pick }).opps.map(o => o.oid).concat(ownToday ? [team.id] : []);
  if (waitIds.length) {
    const B = sundayBounds(tz);
    const today = await rest(`games?or=(home_team_id.in.(${waitIds.join(',')}),away_team_id.in.(${waitIds.join(',')}))&status=in.(scheduled,live,final)&tipoff_at=gte.${B.from.toISOString()}&tipoff_at=lt.${B.to.toISOString()}&select=id,status,tipoff_at,finalised_at`);
    const hold = sundayHold(today, new Date(), sundayCutoff(tz));
    if (hold.wait) { console.log('sunday', club, ': waiting,', hold.why); return failed; }
    if (today.length) console.log('sunday', club, ': sending,', hold.why);
  }
  if (!(await sendWeek(sub, team, tz, sent, W, L.date, pick))) await log(sub, 'sunday', L.date, 'nothing this week');
  return failed;
}

/* ------------------------------------------------------------------ "send next week's reports now" (0226) --- */
/* The console's requests (report_mail_requests), taken BEFORE the rounds. One is the Sunday email at once, for the week
   that begins next Monday at the address's own time, and it counts as that Sunday's (sendWeek logs the Sunday before the
   week), so the Sunday round finds it done. A Sunday email already sent is sent again: it was asked for. No games that
   week and no team report due is not logged as the Sunday (the fixtures may yet be announced): the request says nothing
   to send. Each is claimed (another run cannot take it), run, and left sent, nothing or failed, with the line the console
   shows. Requests not done in three hours are given up, as the database does when it is next asked. */
const SUB_SELECT = '*,teams(id,name,colour,leagues(timezone))';
const GIVE_UP_MS = 3 * 36e5;
export function requestLine(W, tz, done) {
  const week = 'the week of ' + dayShort(W.from.toISOString(), tz);
  if (!done) return 'No games in ' + week + ' and no team report due: nothing to send.';
  const what = [];
  if (done.names.length) what.push('scouting report' + (done.names.length > 1 ? 's' : '') + ' on ' + listOf(done.names));
  if (done.own) what.push('the club’s own team report');
  return 'Sent ' + week + ': ' + what.join(', plus ') + (done.players ? '; and ' + done.players + ' player report' + (done.players === 1 ? '' : 's') + ' in a reply' : '') + '.';
}
export async function requests(now = new Date()) {
  if (!DRY) await rest(`report_mail_requests?state=in.(queued,running)&requested_at=lt.${new Date(now.getTime() - GIVE_UP_MS).toISOString()}`, { method: 'PATCH',
    body: JSON.stringify({ state: 'failed', finished_at: new Date().toISOString(), detail: 'Not done within three hours: send it again.' }) });
  /* the request's own ticks (0263 pick); before 0263 there is no such column, and the request is the whole week as before */
  let rows;
  try { rows = await rest(`report_mail_requests?state=eq.queued&select=id,pick,sub:report_mail_subs(${SUB_SELECT})&order=requested_at.asc`); }
  catch (e) { if (!/pick/.test(e.message || '')) throw e; rows = await rest(`report_mail_requests?state=eq.queued&select=id,sub:report_mail_subs(${SUB_SELECT})&order=requested_at.asc`); }
  let failed = 0;
  for (const r of rows) {
    const s = r.sub;
    if (!s || (env.ONLY && s.email !== env.ONLY)) continue;
    const mark = (state, detail) => DRY ? Promise.resolve() : rest(`report_mail_requests?id=eq.${r.id}`, { method: 'PATCH',
      body: JSON.stringify({ state, finished_at: new Date().toISOString(), detail: String(detail).slice(0, 400) }) });
    if (!DRY) {
      const got = await rest(`report_mail_requests?id=eq.${r.id}&state=eq.queued`, { method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ state: 'running', started_at: new Date().toISOString() }) });
      if (!got.length) continue;                                        // another run has it
    }
    if (!s.active) { await mark('nothing', 'This address is paused: nothing was sent.'); continue; }
    const team = s.teams || { id: s.team_id, name: 'your club' }, tz = tzOf(s, team);
    try {
      const W = nextWeek(tz, now);
      console.log('send now', s.email, '->', team.name, '| the week from', W.from.toISOString());
      const done = await sendWeek(s, team, tz, await rest(`report_mail_log?sub_id=eq.${s.id}&select=kind,ref,sent_at`), W, W.sunday, r.pick || null);
      await mark(done ? 'sent' : 'nothing', requestLine(W, tz, done));
    } catch (e) {
      failed++; console.error('[' + s.email + '] send now:', e.message || e);
      await mark('failed', e.message || e).catch(() => {});
    }
  }
  return failed;
}

/* ------------------------------------------------------------------ a player's own week (0272) --- */
/* WEEKLY PLAYER REPORTS (Louie, 2026-10-16: "insert a player's email, and they then get a weekly player report sent to them
   updated"): an address and a player (report_mail_players, platform administrators only), and every Monday from 8 am at the
   address's time, the week just played, Monday to Sunday: the player's report drawn for that week (p/?p=&tab=report&rpweek=,
   its GAMES PLAYED DURING THE WEEK section) attached to an email that lists the week's games. A week without a game of theirs
   goes unsent ("skip that week"). A Monday missed (a dropped cron) is caught up on the Tuesday, for that same week. On the
   Monday a game of the club's still being played or finalised is waited for; on the Tuesday nothing is. "Send now" (the
   console's send_now_at) sends the week of their latest game at the next run, whatever the day. Logged once a week
   (report_mail_player_log: address and week), so no week goes twice; what the mailer last did is left on the address
   (last_at, last_detail) for the console. */
export const PLAYER_FROM_MIN = 8 * 60;
const ymdShift = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const mondayOf = ymd => ymdShift(ymd, -((new Date(ymd + 'T12:00:00Z').getUTCDay() + 6) % 7));
/* the week an address's email is for at this instant, or null: on Monday from 8 am, the week before it; on Tuesday (a Monday
   missed), the same week. `week` is that week's Monday, a date at the address's time. */
export function playerWeekDue(tz, now = new Date()) {
  const L = local(tz, now);
  const back = L.wd === 'Mon' && L.hour * 60 + L.mi >= PLAYER_FROM_MIN ? 7 : L.wd === 'Tue' ? 8 : null;
  return back == null ? null : { week: ymdShift(L.date, -back), catchUp: L.wd === 'Tue' };
}
/* Monday 00:00 to the next Monday 00:00 of a week, at the address's time */
export function weekBounds(tz, monday) {
  const [y, mo, d] = monday.split('-').map(Number);
  const e = new Date(Date.UTC(y, mo - 1, d + 7));
  return { from: new Date(midnight(y, mo, d, tz)), to: new Date(midnight(e.getUTCFullYear(), e.getUTCMonth() + 1, e.getUTCDate(), tz)) };
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/* "6–12 October 2026", "29 September – 5 October 2026" */
export function weekSpan(monday) {
  const a = new Date(monday + 'T12:00:00Z'), b = new Date(ymdShift(monday, 6) + 'T12:00:00Z');
  return a.getUTCMonth() === b.getUTCMonth() ? a.getUTCDate() + '–' + b.getUTCDate() + ' ' + MONTHS[b.getUTCMonth()] + ' ' + b.getUTCFullYear()
    : a.getUTCDate() + ' ' + MONTHS[a.getUTCMonth()] + (a.getUTCFullYear() === b.getUTCFullYear() ? '' : ' ' + a.getUTCFullYear()) + ' – ' + b.getUTCDate() + ' ' + MONTHS[b.getUTCMonth()] + ' ' + b.getUTCFullYear();
}
/* a game row of theirs as the email lists it: the side they were on, the score their way round, their line */
export function playerLine(r) {
  const g = r.games || {}, side = +r.team_idx === 1 ? 1 : 0, s = r.stats || {};
  const us = side ? g.away_score : g.home_score, them = side ? g.home_score : g.away_score;
  const opp = ((side ? g.home : g.away) || {}).name || 'opponent';
  return { tipoff_at: g.tipoff_at, home: side === 0, opp, us, them, res: us > them ? 'W' : us < them ? 'L' : 'T',
    pts: +s.pts || 0, reb: (+s.or || 0) + (+s.dr || 0), ast: +s.ast || 0, min: (s.adv && s.adv.minTxt) || '' };
}
export const playedIn = r => !!r && r.games && r.games.status === 'final' && !!r.stats && (+r.stats.min > 0 || (r.stats.adv && +r.stats.adv.min > 0));
/* THE EMAIL: the week's games their way round, and what the report attached holds */
export function playerEmail({ sub, name, team, week, games, tz }) {
  const colour = colourOf(team), ink = inkOn(colour), n = games.length;
  const lg = ((team && team.leagues) || {}).name || '';
  const span = weekSpan(week);
  const subject = `${name}: your week, ${span}`;
  const rows = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:2px 0 16px;border:1px solid #e4ebe7;border-radius:8px">' +
    games.map((o, i) => '<tr><td style="padding:9px 12px;' + (i ? 'border-top:1px solid #e4ebe7;' : '') + F + 'font-size:14px;color:#0d1f17;white-space:nowrap"><b>' + esc(dayShort(o.tipoff_at, tz)) + '</b></td>' +
      '<td style="padding:9px 12px;' + (i ? 'border-top:1px solid #e4ebe7;' : '') + F + 'font-size:14px;color:#0d1f17">' + (o.home ? 'v ' : 'at ') + '<b>' + esc(o.opp) + '</b>' +
        '<div style="font-size:12px;color:#5b6b63">' + o.pts + ' pts · ' + o.reb + ' reb · ' + o.ast + ' ast' + (o.min ? ' · ' + esc(o.min) + ' min' : '') + '</div></td>' +
      '<td align="right" style="padding:9px 12px;' + (i ? 'border-top:1px solid #e4ebe7;' : '') + F + 'font-size:14px;font-weight:bold;white-space:nowrap;color:' + (o.res === 'W' ? '#0a6d43' : o.res === 'L' ? '#a3262f' : '#0d1f17') + '">' +
        esc(o.res + ' ' + o.us + '–' + o.them) + '</td></tr>').join('') + '</table>';
  const blocks = [
    P(`Here is your player report, updated with the week’s ${n === 1 ? 'game' : (NUM[n] || n) + ' games'}:`),
    rows,
    P('Inside:'),
    UL(['<b>Main stats</b>: your season line, every figure ranked against the players of your position in the competition',
      '<b>Shot chart</b>: where you shoot from and how well, in the half court and in transition',
      '<b>Left v right</b>: your shooting from each side of the floor',
      '<b>Connections</b>: the teammates you set up most, and the shots your passes become',
      '<b>On the floor with</b>: the team with you on and off, and your best and worst pairings',
      '<b>Games played during the week</b>: your shot chart from each game, and your full stats line from each',
      '<b>Actionable insights</b>: what is working and what to work on, for your position']),
    NOTE(ink, 'Every figure is coloured against the players of your position, green good and red poor; the legend at the back explains each statistic, and every stat named links to it.'),
    P('Have a good week.')];
  return { subject, html: layout({ colour, kicker: 'Weekly player report' + (lg ? ' · ' + lg : ''), title: `${name}: ${n === 1 ? 'one game' : (NUM[n] || n) + ' games'} this week`,
    meta: span + (team && team.name ? ' · ' + team.name : ''), greeting: sub.name ? 'Hi ' + sub.name + ',' : 'Hello,', blocks,
    files: [{ label: 'Player report: ' + name + ', ' + span }], kept: false,
    foot: 'You receive this because a weekly player report was set up for this address on Epinoia. To change or stop it, simply reply to this email and let us know.' }) };
}
/* every profile of theirs (0178: the same person in another competition's feed), else their own */
async function linkedIds(id) {
  try {
    const L = await rest('rpc/linked_players', { method: 'POST', body: JSON.stringify({ p_player: id }) });
    const ids = ((L && L.players) || []).map(p => p.id).filter(Boolean);
    return [...new Set([id].concat(ids))];
  } catch (_) { return [id]; }
}
const PG_SEL = 'game_id,team_idx,player_uuid,stats,games!inner(id,tipoff_at,status,home_score,away_score,home:home_team_id(name),away:away_team_id(name))';
async function playerGamesIn(ids, from, to) {
  const rows = await rest(`player_game_stats?player_uuid=in.(${ids.join(',')})&select=${PG_SEL}&games.status=eq.final` +
    `&games.tipoff_at=gte.${encodeURIComponent(from.toISOString())}&games.tipoff_at=lt.${encodeURIComponent(to.toISOString())}`);
  return (rows || []).filter(playedIn).sort((a, b) => String(a.games.tipoff_at).localeCompare(String(b.games.tipoff_at)));
}
/* the Monday of the week of their latest game (send now), at the address's time */
async function latestWeek(ids, tz, now) {
  const since = new Date(now.getTime() - 200 * 864e5);
  const rows = await playerGamesIn(ids, since, new Date(now.getTime() + 36e5));
  return rows.length ? mondayOf(local(tz, new Date(rows[rows.length - 1].games.tipoff_at)).date) : null;
}
/* a game of the club's that week still being played or finalised (not one the feed lost: SUNDAY_STALE_MS after its tip-off) */
async function clubStillPlaying(teamId, from, to, now) {
  const rows = await rest(`games?or=(home_team_id.eq.${teamId},away_team_id.eq.${teamId})&status=in.(scheduled,live,finalising)` +
    `&tipoff_at=gte.${encodeURIComponent(from.toISOString())}&tipoff_at=lt.${encodeURIComponent(to.toISOString())}&select=id,tipoff_at,status`).catch(() => []);
  return (rows || []).some(g => g.tipoff_at && Date.parse(g.tipoff_at) <= now.getTime() && now.getTime() - Date.parse(g.tipoff_at) <= SUNDAY_STALE_MS);
}
const notePlayer = (s, detail, clear) => (DRY ? Promise.resolve() : rest(`report_mail_players?id=eq.${s.id}`, { method: 'PATCH',
  body: JSON.stringify(Object.assign({ last_at: new Date().toISOString(), last_detail: String(detail).slice(0, 400) }, clear ? { send_now_at: null } : {})) }).catch(e => console.warn('[' + s.email + '] note:', e.message || e)));
async function logPlayerWeek(s, week, detail) {
  if (DRY) return;
  for (let i = 0; ; i++) {
    try { return await rest('report_mail_player_log?on_conflict=sub_id,week', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify({ sub_id: s.id, week, detail: detail || null }) }); }
    catch (e) { if (i >= 2) throw e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
  }
}
export async function onePlayer(s, now = new Date()) {
  const P = s.players || { id: s.player_id };
  const name = ((P.first_name || '') + ' ' + (P.last_name || '')).trim() || 'The player';
  const re = await rest(`roster_entries?player_id=eq.${s.player_id}&select=teams(id,name,colour,leagues(name,timezone))&order=created_at.desc&limit=1`).catch(() => []);
  const team = (re && re[0] && re[0].teams) || { id: null, name: '', colour: null };
  const tz = okZone(s.tz, team.leagues && team.leagues.timezone);
  const ids = await linkedIds(s.player_id);
  const asked = !!s.send_now_at;
  let week, catchUp = false;
  if (asked) {
    week = await latestWeek(ids, tz, now);
    if (!week) { await notePlayer(s, 'Send now: no game of theirs in the last 200 days, so nothing was sent.', true); return 0; }
  } else {
    const due = playerWeekDue(tz, now);
    if (!due) return 0;
    week = due.week; catchUp = due.catchUp;
    if ((await rest(`report_mail_player_log?sub_id=eq.${s.id}&week=eq.${week}&select=id`)).length) return 0;
  }
  const B = weekBounds(tz, week);
  const games = (await playerGamesIn(ids, B.from, B.to)).map(playerLine);
  /* a week they did not play goes unsent; not logged, so a game finalised late still brings it on the Tuesday */
  if (!games.length) { if (asked) await notePlayer(s, 'Send now: no game of theirs in the week of ' + weekSpan(week) + ', so nothing was sent.', true); return 0; }
  if (!asked && !catchUp && team.id && await clubStillPlaying(team.id, B.from, B.to, now)) { console.log('[' + s.email + '] ' + name + ': a game of the week is still to finish; waiting'); return 0; }
  const file = 'epinoia-player-report-' + String(name).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '-' + week;
  console.log('[' + s.email + '] ' + name + ': the week of ' + week + ', ' + games.length + ' game(s)' + (asked ? ' (send now)' : catchUp ? ' (caught up)' : ''));
  const pdf = await pdfOf('/epinoia/p/?p=' + encodeURIComponent(P.slug || s.player_id) + '&tab=report&rpweek=' + week, file);
  const E = playerEmail({ sub: s, name, team, week, games, tz });
  await send(s.email, E.subject, E.html, [pdf]);
  await logPlayerWeek(s, week, games.length + ' game(s)' + (asked ? ', send now' : ''));
  await notePlayer(s, 'Sent the week of ' + weekSpan(week) + ' (' + (games.length === 1 ? 'one game' : games.length + ' games') + ')' + (asked ? ', asked for' : ''), asked);
  return 0;
}
/* every active address (none before 0272 is applied: the table is not there, which must not stop the clubs' rounds) */
export async function playerRound(now = new Date()) {
  const subs = await rest('report_mail_players?active=eq.true&select=*,players(id,first_name,last_name,slug)');
  let failed = 0;
  for (const s of subs || []) {
    if (env.ONLY && s.email !== env.ONLY) continue;
    try { failed += (await onePlayer(s, now)) || 0; }
    catch (e) { failed++; console.error('[' + s.email + '] player report:', e.message || e); await notePlayer(s, 'Not sent: ' + (e.message || e), false); }
  }
  return { failed, n: (subs || []).length };
}

/* ------------------------------------------------------------------ everybody --- */
async function main() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) { console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are needed'); process.exit(1); }
  if (!DRY && !env.RESEND_API_KEY) { console.error('RESEND_API_KEY is needed to send (or DRY=1)'); process.exit(1); }
  const subs = await rest('report_mail_subs?active=eq.true&select=*,teams(id,name,colour,leagues(timezone))');
  let failed = 0;
  /* the console's "send next week's reports now" first (0226); that table is away until the migration is applied, which must not stop the rounds */
  try { failed += await requests(); } catch (e) { console.warn('send-now requests skipped:', e.message || e); }
  for (const s of subs) {
    if (env.ONLY && s.email !== env.ONLY) continue;
    try { failed += (await one(s, s.teams || { id: s.team_id, name: 'your club' })) || 0; }
    catch (e) { failed++; console.error('[' + s.email + ']', e.message || e); }
  }
  /* THE PLAYERS' WEEKLY REPORTS (0272): Monday mornings, and any "send now"; before 0272 the table is not there */
  let players = 0;
  try { const PR = await playerRound(); failed += PR.failed; players = PR.n; } catch (e) { console.warn('player reports skipped:', e.message || e); }
  /* the primed copies emailed in this run, the stale and the old, deleted (0229) */
  try { const n = await cleanPrimed(); if (n) console.log(n + ' primed report(s) deleted'); } catch (e) { console.warn('primed copies not cleaned:', e.message || e); }
  if (browser) await browser.close();
  console.log(subs.length + ' address(es), ' + players + ' player address(es), ' + failed + ' failed');
  if (failed) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
