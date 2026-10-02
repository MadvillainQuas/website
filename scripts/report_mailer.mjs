/* ============================================================================
   REPORTS BY EMAIL (0221; .github/workflows/report-mail.yml, every half hour).

   For every active row of report_mail_subs (an address, a club, a time zone, set in the platform console):
     GAME      each of the club's games finalised since the address was added (and in the last week), not yet sent:
               the game analysis PDF from the club's side (game/analysis.js), one email a game, as soon as it is final,
               with the club's next fixture
     SUNDAY    once on Sunday from 8 am at the address's own time: the club reports (t/ Report tab) of every opponent
               the club plays in the week ahead, Monday to Sunday at that time (so a Sunday game is in the email the
               Sunday before it, never in two), and every other Sunday the club's own report too, all in ONE email.
               An address's first Sunday also takes in any game later that day. A Sunday with neither sends nothing.
   report_mail_log keeps what went (a row a game, a row a Sunday), so a rerun never sends twice.

   The PDFs are the site's own: a headless Chromium opens the page served from this checkout (SITE, a local server the
   workflow starts), presses the report's own "Download PDF" and takes the file. EPINOIA_RP_BOT, set before the page's
   scripts run, opens the members' report for the member it is bought for, and draws it at email weight (report.js).
   An email that would still pass Resend's size limit goes as parts ("part 1 of 2"), each whole.

   env: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, REPORTS_FROM ("Epinoia <reports@...>"), SITE (default
        http://127.0.0.1:8765), DRY=1 (build and log nothing, send nothing: prints what it would do), ONLY=<email>
   The helpers below are exported (supabase/tests/report-mailer.test.mjs); the run starts only when this is the script.
   ============================================================================ */
import { pathToFileURL } from 'node:url';

const env = process.env;
const SITE = (env.SITE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const DRY = env.DRY === '1' || env.DRY === 'true';
const FROM = env.REPORTS_FROM || 'Epinoia <onboarding@resend.dev>';
/* Resend takes 40 MB an email, attachments base64-encoded; parts stay under this */
export const MAX_EMAIL_BYTES = 34e6;

/* ------------------------------------------------------------------ the database --- */
const H = () => ({ apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json' });
async function rest(path, opt = {}) {
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/' + path, { ...opt, headers: { ...H(), ...(opt.headers || {}) } });
  if (!r.ok) throw new Error(r.status + ' on ' + path.split('?')[0] + ': ' + (await r.text()).slice(0, 300));
  return r.status === 204 ? null : r.json();
}
const log = (sub, kind, ref, detail) => DRY ? Promise.resolve() :
  rest('report_mail_log', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify({ sub_id: sub.id, kind, ref, detail: detail || null }) });

/* ------------------------------------------------------------------ time in the reader's zone --- */
const partsOf = (tz, d) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    second: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second, wd: p.weekday };
};
export const local = (tz, d = new Date()) => { const p = partsOf(tz, d); return { date: p.y + '-' + String(p.mo).padStart(2, '0') + '-' + String(p.d).padStart(2, '0'), hour: p.h, wd: p.wd }; };
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
const dayName = (iso, tz) => new Date(iso).toLocaleDateString('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' });
const dayShort = (iso, tz) => new Date(iso).toLocaleDateString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' });
const timeOf = (iso, tz) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' });

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
export function layout({ colour, kicker, title, meta, greeting, blocks, files }) {
  const ink = inkOn(colour);
  const fileRows = (files || []).map(f => '<tr><td style="padding:7px 0;border-top:1px solid #e4ebe7;' + F + 'font-size:14px;color:#0d1f17">' +
    '<span style="display:inline-block;padding:2px 6px;margin-right:8px;border-radius:4px;background:' + ink + ';color:#ffffff;font-size:10px;font-weight:bold;letter-spacing:.06em">PDF</span>' +
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
        'You receive these because your club’s reports were set up for this address on Epinoia. To change or stop them, simply reply to this email and let us know.' +
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
export function sundayEmail({ sub, team, games, ownDue, tz, monday }) {
  const club = team.name, colour = colourOf(team), ink = inkOn(colour);
  const { opps, uniq } = opponentsOf(team, games);
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
        P(`There are no games for ${esc(club)} in the week ahead, so this Sunday brings your fortnightly team report, attached: the season’s four factors and ` +
          'season line, shooting at both ends, the squad’s profiles, the depth chart and the most-used lineups, each figure coloured against the competition’s clubs.'),
        P('Enjoy the week, and we will be in touch as soon as the next game is on the schedule.')] }) };
  }
  const subject = `Your week ahead: scouting report${n > 1 ? 's' : ''} on ${listOf(uniq.map(o => o.oname))}${ownDue ? ', plus ' + possessive(club) + ' team report' : ''}`;
  return { subject, html: layout({ colour, kicker: 'The week ahead' + (week ? ' · from ' + week : ''), title: `${club}: ${NUM[k] || k} game${k > 1 ? 's' : ''} this week`,
    meta: 'Times are ' + tz.replace(/_/g, ' ').split('/').pop() + ' time', greeting: sub.name ? 'Hi ' + sub.name + ',' : 'Hello,', files, blocks: [
      P(`${esc(club)} ${k === 1 ? 'has one game' : 'have ' + (NUM[k] || k) + ' games'} in the week ahead:`),
      FIXTURES(opps, tz),
      P(`Attached ${n > 1 ? 'are scouting reports on each opponent' : 'is a scouting report on ' + esc(uniq[0].oname)}, so you can prepare in good time. Each covers:`),
      inside,
      ownDue ? NOTE(ink, `As it is your fortnightly report week, ${esc(possessive(club))} own team report is attached too, so you can see how the season is shaping up on the same measures.`) : '',
      P('Good luck this week.')].filter(Boolean) }) };
}

/* ------------------------------------------------------------------ the PDFs and sending --- */
let browser = null;
/* opt.context: a browser context of the caller's (a test routes the page's calls through it) */
export async function pdfOf(path, name, opt = {}) {
  let ctx = opt.context;
  if (!ctx) {
    if (!browser) { const { chromium } = await import('playwright'); browser = await chromium.launch(); }
    ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 }, acceptDownloads: true });
  }
  await ctx.addInitScript(() => { window.EPINOIA_RP_BOT = true; });
  const page = await ctx.newPage();
  try {
    await page.goto(SITE + path, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__rpBuilt > 0, null, { timeout: 300000 });
    await page.waitForTimeout(1500);
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
async function send(to, subject, html, attachments) {
  const parts = partsOfFiles(attachments);
  for (let i = 0; i < parts.length; i++) {
    const subj = subject + (parts.length > 1 ? ` (part ${i + 1} of ${parts.length})` : '');
    if (DRY) { console.log('[dry] to', to, '|', subj, '|', parts[i].map(a => a.filename).join(', ')); continue; }
    const r = await fetch('https://api.resend.com/emails', { method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject: subj, html, attachments: parts[i] }) });
    if (!r.ok) throw new Error('resend ' + r.status + ': ' + (await r.text()).slice(0, 300));
  }
}

/* ------------------------------------------------------------------ one address --- */
const GAME_SELECT = 'id,home_team_id,away_team_id,home_score,away_score,tipoff_at,venue,home:home_team_id(name),away:away_team_id(name)';
async function one(sub, team) {
  const tz = sub.tz || (team.leagues && team.leagues.timezone) || 'UTC';
  const sent = await rest(`report_mail_log?sub_id=eq.${sub.id}&select=kind,ref,sent_at`);
  const has = (kind, ref) => sent.some(x => x.kind === kind && x.ref === ref);
  const club = team.name;
  const mine = `or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})`;

  /* GAME: every final since the address was added, in the last week, not sent yet; oldest first */
  const since = new Date(Math.max(Date.parse(sub.created_at), Date.now() - 7 * 864e5)).toISOString();
  const games = await rest(`games?${mine}&status=eq.final&finalised_at=gte.${since}&select=${GAME_SELECT},competitions(name,seasons(leagues(name)))&order=tipoff_at.asc`);
  for (const g of games) {
    if (has('game', g.id)) continue;
    const side = g.home_team_id === team.id ? 0 : 1;
    const [next] = await rest(`games?${mine}&status=in.(scheduled,live)&tipoff_at=gt.${g.tipoff_at || new Date().toISOString()}&select=${GAME_SELECT}&order=tipoff_at.asc&limit=1`);
    const E = gameEmail({ sub, team, g, side, next, tz });
    const opp = ((side ? g.home : g.away) || {}).name || 'opponent';
    console.log('game', club, 'v', opp, g.id);
    const pdf = await pdfOf(`/epinoia/game/?g=${g.id}&analysis=${side}`, `game-analysis-${slug(club)}-v-${slug(opp)}-${(g.tipoff_at || '').slice(0, 10)}`);
    await send(sub.email, E.subject, E.html, [pdf]);
    await log(sub, 'game', g.id, `${side ? g.away_score : g.home_score}-${side ? g.home_score : g.away_score} v ${opp}`);
  }

  /* SUNDAY: from 8 am, once, at their own time; the week ahead is Monday to Sunday */
  const L = local(tz);
  if (L.wd !== 'Sun' || L.hour < 8 || has('sunday', L.date)) return;
  const W = weekAhead(tz, new Date(), !sent.some(x => x.kind === 'sunday'));
  const next = await rest(`games?${mine}&status=in.(scheduled,live)&tipoff_at=gte.${W.from.toISOString()}&tipoff_at=lt.${W.to.toISOString()}&select=${GAME_SELECT}&order=tipoff_at.asc`);
  const lastTeam = sent.filter(x => x.kind === 'team').map(x => Date.parse(x.sent_at)).sort((a, b) => a - b).pop() || 0;
  const ownDue = Date.now() - lastTeam > 13 * 864e5;
  if (!next.length && !ownDue) { await log(sub, 'sunday', L.date, 'nothing this week'); return; }
  const { uniq } = opponentsOf(team, next);
  const att = [];
  for (const o of uniq) { console.log('opponent', club, '->', o.oname); att.push(await pdfOf(`/epinoia/t/?t=${o.oid}&tab=report`, `scouting-report-${slug(o.oname)}`)); }
  if (ownDue) { console.log('own', club); att.push(await pdfOf(`/epinoia/t/?t=${team.id}&tab=report`, `team-report-${slug(club)}`)); }
  const E = sundayEmail({ sub, team, games: next, ownDue, tz, monday: W.from });
  await send(sub.email, E.subject, E.html, att);
  await log(sub, 'sunday', L.date, uniq.length + ' opponent(s)' + (ownDue ? ' + own' : ''));
  if (ownDue) await log(sub, 'team', L.date, 'own report');
}

/* ------------------------------------------------------------------ everybody --- */
async function main() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) { console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are needed'); process.exit(1); }
  if (!DRY && !env.RESEND_API_KEY) { console.error('RESEND_API_KEY is needed to send (or DRY=1)'); process.exit(1); }
  const subs = await rest('report_mail_subs?active=eq.true&select=id,email,name,tz,created_at,team_id,teams(id,name,colour,leagues(timezone))');
  let failed = 0;
  for (const s of subs) {
    if (env.ONLY && s.email !== env.ONLY) continue;
    try { await one(s, s.teams || { id: s.team_id, name: 'your club' }); }
    catch (e) { failed++; console.error('[' + s.email + ']', e.message || e); }
  }
  if (browser) await browser.close();
  console.log(subs.length + ' address(es), ' + failed + ' failed');
  if (failed) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
