// 0276 OUTREACH (Louie, 2026-10-16): the clubs' own published contact addresses and the pitch for the report
// subscription, ticked in the platform console and sent by hand from the owner's own email. Held here:
//   * the letter: merge fields filled, nothing in a template ever markup, addresses as links, the EPINOIA dress (the
//     bar, the club's colour, the kicker, the sign-off, the foot with how to say no);
//   * the email file a mail program opens as a draft (recipient, encoded subject, plain and styled parts);
//   * nothing in the tab sends an email - it opens the owner's own mail, copies, downloads;
//   * the countries whose law wants consent first are flagged;
//   * the migration: platform administrators only, an import that never resets a club's state, the pitch to start from;
//   * the console wiring.
//
//   node supabase/tests/outreach.test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const req = createRequire(import.meta.url);
const O = req(path.join(ROOT, 'epinoia', 'admin', 'platform', 'outreach-ui.js'));
const read = f => readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 300))); } };

console.log('the letter');
ok('merge fields filled, an unknown one left empty', O.merge('Hi {{club}} team, {{ league }} {{nope}}!', { club: 'London Lions', league: 'SLB' }) === 'Hi London Lions team, SLB !');
const html = O.letterHTML({ colour: '#e94f1f', kicker: 'Super League Basketball Men', title: 'London Lions: <b>analysed</b>',
  body: 'Hi London Lions team,\n\nYour page: https://prophesyscouting.co.uk/epinoia/t/?t=1.\n\n<script>alert(1)</script>', signoff: 'Kind regards,\nLouie', foot: 'Reply "no thanks".' });
ok('the EPINOIA dress: the bar, the club\'s colour, the kicker, paragraphs, the sign-off', /letter-spacing:\.32em;color:#ffffff">EPINOIA</.test(html)
   && /background:#e94f1f/.test(html) && /SUPER LEAGUE|Super League Basketball Men/.test(html) && /<p style="margin:0 0 14px">Hi London Lions team,<\/p>/.test(html)
   && /Kind regards,<br>Louie/.test(html));
ok('nothing in a template is ever markup', !/<script>/.test(html) && /&lt;script&gt;/.test(html) && /London Lions: &lt;b&gt;analysed/.test(html));
ok('an address is a link, its full stop left outside it', /<a href="https:\/\/prophesyscouting\.co\.uk\/epinoia\/t\/\?t=1"/.test(html));
ok('the foot says how to say no', /Reply &quot;no thanks&quot;/.test(html));
const text = O.letterText({ body: 'Hi team,\n\nWords.', signoff: 'Kind regards,\nLouie', foot: 'Reply no.' });
ok('the plain words: the letter, the sign-off, the foot', /^Hi team,\n\nWords\.\n\nKind regards,\nLouie\n\n--\nReply no\./.test(text), text);
ok('a club\'s colour as ink that reads on white', O.inkOn('#ffe14d') !== '#ffe14d' && O.inkOn('nonsense') === '#08603f');

console.log('\nthe email file');
globalThis.btoa = globalThis.btoa || (s => Buffer.from(s, 'binary').toString('base64'));
const eml = O.emlOf('info@club.example', 'Lions: analysed – after every game', 'plain', '<p>styled</p>');
ok('a draft a mail program opens: recipient, encoded subject, unsent, plain and styled parts', /^To: info@club\.example\r\n/.test(eml)
   && /Subject: =\?UTF-8\?B\?/.test(eml) && /X-Unsent: 1/.test(eml) && /multipart\/alternative/.test(eml)
   && /Content-Type: text\/plain; charset=UTF-8/.test(eml) && /Content-Type: text\/html; charset=UTF-8/.test(eml));

console.log('\nnothing is sent from here');
const ui = read('epinoia/admin/platform/outreach-ui.js');
ok('the tab never sends: no mail API, no send function call - it opens the owner\'s own mail, copies, downloads',
   !/resend|api\.resend|sendmail|functions\.invoke|rpc\('send|\/emails['"]/i.test(ui) && /mail\.google\.com\/mail\/\?view=cm/.test(ui) && /ClipboardItem/.test(ui));
ok('no owner\'s address is written into the code', !/@gmail\.com/i.test(ui));
ok('countries whose law wants consent first are flagged', ['CA', 'DE', 'AT', 'IT', 'ES', 'PL'].every(c => O.CONSENT[c]) && !O.CONSENT.GB && /CONSENT FIRST/.test(ui));
ok('every letter is sandboxed in its preview', /setAttribute\('sandbox', ''\)/.test(ui));

console.log('\nthe database');
const sql = read('supabase/migrations/0276_outreach.sql');
ok('platform administrators only: both tables under RLS, the import checks too', /create policy outreach_contacts_admin[\s\S]*is_platform_admin\(\)/.test(sql)
   && /create policy outreach_templates_admin[\s\S]*is_platform_admin\(\)/.test(sql) && /outreach_import[\s\S]*if not coalesce\(public\.is_platform_admin\(\), false\)/.test(sql)
   && /revoke all on function public\.outreach_import\(jsonb\) from public, anon/.test(sql));
ok('a re-import never touches a club\'s state or notes', !/update outreach_contacts set[\s\S]*?\bstatus\s*=/.test(sql.slice(sql.indexOf('update outreach_contacts set'), sql.indexOf('where id = v_id'))));
ok('one address per club once, an address checked, a website an address', /unique \(club_key, email\)/.test(sql) && /outreach_contacts_email_ck/.test(sql) && /outreach_contacts_web_ck/.test(sql));
ok('the pitch to start from: merge fields, the club\'s page, and how to say no', /\{\{club_page\}\}/.test(sql) && /no thanks/.test(sql) && /on conflict \(name\) do nothing/.test(sql));
ok('no person\'s name is kept: the contacts have no name column', !/contact_name|first_name|last_name|person/i.test(sql.slice(sql.indexOf('create table if not exists public.outreach_contacts'), sql.indexOf('create index'))));

console.log('\nthe console');
const page = read('epinoia/admin/platform/index.html'), pj = read('epinoia/admin/platform/platform.js');
ok('the Outreach tab, its pane, its script and its loader', /data-p="outreach"/.test(page) && /id="pane-outreach"><div id="outreachHost">/.test(page)
   && /outreach-ui\.js\?v=\d+/.test(page) && /outreach: loadOutreach/.test(pj) && /EpinoiaOutreachUI/.test(pj));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
