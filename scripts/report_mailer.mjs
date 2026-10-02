/* ============================================================================
   REPORTS BY EMAIL (0221; .github/workflows/report-mail.yml, every half hour).

   For every active row of report_mail_subs (an address, a club, a time zone, set in the platform console):
     GAME      each of the club's games finalised since the address was added (and in the last week), not yet sent:
               the game analysis PDF from the club's side (game/analysis.js), one email a game, as soon as it is final
     SUNDAY    once on Sunday from 8 am at the address's own time: the club reports (t/ Report tab) of every opponent
               the club plays in the coming week, and every other Sunday the club's own report too, all in ONE email.
               A Sunday with neither sends nothing.
   report_mail_log keeps what went (a row a game, a row a Sunday), so a rerun never sends twice.

   The PDFs are the site's own: a headless Chromium opens the page served from this checkout (SITE, a local server the
   workflow starts), presses the report's own "Download PDF" and takes the file. EPINOIA_RP_BOT, set before the page's
   scripts run, opens the members' report for the member it is bought for.

   env: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, REPORTS_FROM ("Epinoia <reports@...>"), SITE (default
        http://127.0.0.1:8765), DRY=1 (build and log nothing, send nothing: prints what it would do), ONLY=<email>
   ============================================================================ */
import { chromium } from 'playwright';

const URL_ = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
const SITE = (process.env.SITE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const DRY = process.env.DRY === '1' || process.env.DRY === 'true';
const FROM = process.env.REPORTS_FROM || 'Epinoia <onboarding@resend.dev>';
if (!URL_ || !KEY) { console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are needed'); process.exit(1); }
if (!DRY && !process.env.RESEND_API_KEY) { console.error('RESEND_API_KEY is needed to send (or DRY=1)'); process.exit(1); }

const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
async function rest(path, opt = {}) {
  const r = await fetch(URL_ + '/rest/v1/' + path, { ...opt, headers: { ...H, ...(opt.headers || {}) } });
  if (!r.ok) throw new Error(r.status + ' on ' + path.split('?')[0] + ': ' + (await r.text()).slice(0, 300));
  return r.status === 204 ? null : r.json();
}
const log = (sub, kind, ref, detail) => DRY ? Promise.resolve() :
  rest('report_mail_log', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify({ sub_id: sub.id, kind, ref, detail: detail || null }) });

/* ------------------------------------------------------------------ dates in the reader's zone --- */
const local = (tz, d = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short', hourCycle: 'h23' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return { date: p.year + '-' + p.month + '-' + p.day, hour: +p.hour, wd: p.weekday };
};
const dayName = (iso, tz) => new Date(iso).toLocaleDateString('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' });
const timeOf = (iso, tz) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' });

/* ------------------------------------------------------------------ the PDFs --- */
let browser = null;
async function pdfOf(path, name) {
  browser = browser || await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 }, acceptDownloads: true });
  await ctx.addInitScript(() => { window.EPINOIA_RP_BOT = true; });
  const page = await ctx.newPage();
  try {
    await page.goto(SITE + path, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__rpBuilt > 0, null, { timeout: 300000 });
    await page.waitForTimeout(1500);
    const dl = page.waitForEvent('download', { timeout: 300000 });
    await page.click('.rp-outs .ep-btn.pri');
    const d = await dl;
    const file = await d.path();
    const bytes = (await import('node:fs')).readFileSync(file);
    return { filename: name + '.pdf', content: bytes.toString('base64') };
  } finally { await ctx.close(); }
}
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ------------------------------------------------------------------ the email --- */
async function send(to, subject, html, attachments) {
  if (DRY) { console.log('[dry] to', to, '|', subject, '|', attachments.map(a => a.filename).join(', ')); return; }
  const r = await fetch('https://api.resend.com/emails', { method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, attachments }) });
  if (!r.ok) throw new Error('resend ' + r.status + ': ' + (await r.text()).slice(0, 300));
}
const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const wrap = (sub, paras) => '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#0d1f17;max-width:620px">' +
  '<p>' + (sub.name ? 'Hi ' + esc(sub.name) + ',' : 'Hello,') + '</p>' + paras.map(p => '<p>' + p + '</p>').join('') +
  '<p>Kind regards,<br>The Epinoia team</p>' +
  '<p style="font-size:12px;color:#5b6b63;border-top:1px solid #dfe7e2;padding-top:10px;margin-top:22px">You receive these because your club’s reports were set up for this address on Epinoia. ' +
  'To change or stop them, simply reply to this email and let us know.</p></div>';

/* ------------------------------------------------------------------ one address --- */
async function one(sub, team) {
  const tz = sub.tz || 'UTC';
  const sent = await rest(`report_mail_log?sub_id=eq.${sub.id}&select=kind,ref,sent_at`);
  const has = (kind, ref) => sent.some(x => x.kind === kind && x.ref === ref);
  const club = team.name;

  /* GAME: every final since the address was added, in the last week, not sent yet; oldest first */
  const since = new Date(Math.max(Date.parse(sub.created_at), Date.now() - 7 * 864e5)).toISOString();
  const games = await rest(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})&status=eq.final&finalised_at=gte.${since}` +
    `&select=id,home_team_id,away_team_id,home_score,away_score,tipoff_at,venue,home:home_team_id(name),away:away_team_id(name),competitions(name,seasons(leagues(name)))&order=tipoff_at.asc`);
  for (const g of games) {
    if (has('game', g.id)) continue;
    const side = g.home_team_id === team.id ? 0 : 1;
    const us = side ? g.away_score : g.home_score, them = side ? g.home_score : g.away_score;
    const opp = (side ? g.home : g.away || {}).name || 'the opposition';
    const won = us > them, lg = (((g.competitions || {}).seasons || {}).leagues || {}).name || (g.competitions || {}).name || '';
    const res = won ? 'win' : us < them ? 'loss' : 'game';
    console.log('game', club, 'v', opp, g.id);
    const pdf = await pdfOf(`/epinoia/game/?g=${g.id}&analysis=${side}`, `game-analysis-${slug(club)}-v-${slug(opp)}-${(g.tipoff_at || '').slice(0, 10)}`);
    const when = g.tipoff_at ? dayName(g.tipoff_at, tz) : 'recently';
    const subject = `Game analysis: ${club} ${us}–${them} ${opp}${lg ? ' (' + lg + ')' : ''}`;
    const html = wrap(sub, [
      `Please find attached the game analysis for ${esc(club)}’s ${res} ${won ? 'over' : us < them ? 'to' : 'against'} ${esc(opp)} (${us}–${them}) on ${esc(when)}${g.venue ? ' at ' + esc(g.venue) : ''}.`,
      `It is drawn from the game’s play-by-play and looks at the game from ${esc(club)}’s side: the four factors and where the game was won and lost, ` +
        `the shot charts at both ends, half-court and transition play, every player’s full statistics for both teams, and the game flow with the runs and rotations. ` +
        `Each figure is coloured against the competition’s clubs over the season, so the strengths and weaknesses of the night stand out at a glance.`,
      `We will send the next one as soon as ${esc(club)}’s following game is final.`]);
    await send(sub.email, subject, html, [pdf]);
    await log(sub, 'game', g.id, `${us}-${them} v ${opp}`);
  }

  /* SUNDAY: from 8 am, once, at their own time */
  const L = local(tz);
  if (L.wd !== 'Sun' || L.hour < 8 || has('sunday', L.date)) return;
  const until = new Date(Date.now() + 8 * 864e5).toISOString();
  const next = await rest(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})&status=in.(scheduled,live)&tipoff_at=gte.${new Date().toISOString()}&tipoff_at=lte.${until}` +
    `&select=id,home_team_id,away_team_id,tipoff_at,venue,home:home_team_id(name),away:away_team_id(name)&order=tipoff_at.asc`);
  const lastTeam = sent.filter(x => x.kind === 'team').map(x => Date.parse(x.sent_at)).sort().pop() || 0;
  const ownDue = Date.now() - lastTeam > 13 * 864e5;
  if (!next.length && !ownDue) { await log(sub, 'sunday', L.date, 'nothing this week'); return; }
  const att = [], lines = [];
  const opps = [];
  for (const g of next) {
    const side = g.home_team_id === team.id ? 0 : 1, oid = side ? g.home_team_id : g.away_team_id, oname = (side ? g.home : g.away || {}).name || 'opponent';
    opps.push({ g, oid, oname, home: side === 0 });
  }
  const uniq = [...new Map(opps.map(o => [o.oid, o])).values()];
  for (const o of uniq) {
    console.log('opponent', club, '->', o.oname);
    att.push(await pdfOf(`/epinoia/t/?t=${o.oid}&tab=report`, `scouting-report-${slug(o.oname)}`));
  }
  if (ownDue) { console.log('own', club); att.push(await pdfOf(`/epinoia/t/?t=${team.id}&tab=report`, `team-report-${slug(club)}`)); }
  opps.forEach(o => lines.push(`<li><b>${esc(o.oname)}</b> · ${esc(dayName(o.g.tipoff_at, tz))}, ${esc(timeOf(o.g.tipoff_at, tz))} · ${o.home ? 'at home' : 'away'}${o.g.venue ? ' (' + esc(o.g.venue) + ')' : ''}</li>`));
  const n = uniq.length;
  const subject = n
    ? `Your week ahead: scouting report${n > 1 ? 's' : ''} on ${uniq.map(o => o.oname).join(' and ')}${ownDue ? ', plus ' + club + '’s team report' : ''}`
    : `${club}’s fortnightly team report`;
  const paras = n ? [
    `${esc(club)} ${next.length === 1 ? 'has a game' : 'have ' + next.length + ' games'} in the week ahead:</p><ul>${lines.join('')}</ul><p>` +
      `Attached ${n > 1 ? 'are scouting reports on each opponent' : 'is a scouting report on ' + esc(uniq[0].oname)}, so you can prepare in good time: ` +
      `their four factors and season line, where they shoot from and how well at both ends, half-court and transition play, every player’s profile, ` +
      `their depth chart, most-used lineups and combinations.`,
    ownDue ? `As it is your fortnightly report week, we have also attached ${esc(club)}’s own team report, so you can see how the season is shaping up on the same measures.` : '',
    `Good luck this week.`] : [
    `There are no games for ${esc(club)} in the coming week, so this Sunday brings only your fortnightly team report, attached: ` +
      `the season’s four factors and season line, shooting at both ends, the squad’s profiles, the depth chart and the most-used lineups, ` +
      `each figure coloured against the competition’s clubs.`,
    `Enjoy the week off, and we will be in touch as soon as the next game is on the schedule.`];
  await send(sub.email, subject, wrap(sub, paras.filter(Boolean)), att);
  await log(sub, 'sunday', L.date, n + ' opponent(s)' + (ownDue ? ' + own' : ''));
  if (ownDue) await log(sub, 'team', L.date, 'own report');
}

/* ------------------------------------------------------------------ everybody --- */
const subs = await rest('report_mail_subs?active=eq.true&select=id,email,name,tz,created_at,team_id,teams(id,name)');
let failed = 0;
for (const s of subs) {
  if (process.env.ONLY && s.email !== process.env.ONLY) continue;
  try { await one(s, s.teams || { id: s.team_id, name: 'your club' }); }
  catch (e) { failed++; console.error('[' + s.email + ']', e.message || e); }
}
if (browser) await browser.close();
console.log(subs.length + ' address(es), ' + failed + ' failed');
if (failed) process.exitCode = 1;
