// 0279: MEMBERSHIP TIERS AS A MATRIX, AND THINGS SOLD ON THEIR OWN, on a real Postgres with every migration applied
// (pg-all-migrations.mjs; skipped with a note when PGlite is not installed). What is held here:
//   * the conversion: every old section follows the matrix ('signin' for what was free, 'tiers' for the rest), each
//     plan's privileges are what its features opened; the front office and Manager mode rows are there;
//   * the matrix decides: Free opens a section to everyone signed out, Signed in to any account, a tier to its
//     holders (a grant of a tier too, and a product's tier that comes with it), staff everything; with memberships
//     switched off everything is open, as before;
//   * the console: a tier, a pass and a product saved (kinds, privileges, mail kinds, a PDF's price paid once), the
//     matrix saved at once, by a platform administrator only;
//   * a PDF paid for once: recorded once per session, the buyer's one download, used once, refunded;
//   * a subscription that builds: the club's or the player's report emails added and switched off when it ends; a
//     private league built with its buyer as administrator, who stops administering it when it lapses and is
//     back when it is paid again; a problem kept on the row, never failing the payment;
//   * the front office for the club's own people with a tier that opens it; Manager mode's clubs written only while
//     it is open.
//
//   TZ=UTC PGLITE_DIR=... node supabase/tests/tiers.test.mjs
import { allMigrations } from './pg-all-migrations.mjs';

let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 600))); } };

const built = await allMigrations();
if (!built) { console.log('  SKIP  tiers: @electric-sql/pglite is not installed'); process.exit(0); }
const { db, failed } = built;
const mine = failed.filter(f => /^027[6-9]/.test(f));
ok('0279 applies on top of every migration', !mine.length, mine);

const q = async (sql, args) => (await db.query(sql, args || [])).rows;
const one = async (sql, args) => (await q(sql, args))[0];
const U = {};
for (const who of ['admin', 'fan', 'member', 'coach', 'stranger', 'buyer']) {
  U[who] = (await one(`insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id`, [who + '@example.test'])).id;
}
await q(`insert into public.memberships (user_id, role, scope_type, scope_id) values ($1, 'platform_admin', 'platform', null)`, [U.admin]);
async function as(who, sql, args) {
  const role = who === 'anon' ? 'anon' : who === 'service' ? 'service_role' : 'authenticated';
  const claims = who === 'anon' || who === 'service' ? { role } : { sub: U[who], role: 'authenticated', email: who + '@example.test' };
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
  await db.exec(`set role ${role}`);
  try { return (await db.query(sql, args || [])).rows; } finally { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claims', '', false)`); }
}
const err = async (who, sql, args) => { try { await as(who, sql, args); return null; } catch (e) { return e.message; } };
const switchOn = on => q(`insert into public.platform_settings (key, value, is_public) values ('memberships_enabled', to_jsonb($1::boolean), true)
                          on conflict (key) do update set value = excluded.value`, [on]);

console.log('\nthe conversion');
{
  const gates = await q(`select key, gate, category from public.access_gates order by key`);
  const by = Object.fromEntries(gates.map(g => [g.key, g]));
  ok('every section follows the matrix: free, signed in or the tiers ticked', gates.every(g => ['free', 'signin', 'tiers'].includes(g.gate)), gates);
  ok('...the old analytics and report sections are by tier, the front office too; Manager mode free to start',
     by.events.gate === 'tiers' && by.playerReport.gate === 'tiers' && by.frontOffice.gate === 'tiers' && by.manager.gate === 'free', [by.events, by.playerReport, by.frontOffice, by.manager]);
  ok('...each in its group of the matrix', by.events.category === 'analytics' && by.playerReport.category === 'reports' && by.frontOffice.category === 'club' && by.manager.category === 'manager');
  const seeds = await q(`select kind, price_pennies, "interval", active from public.access_plans where league_id is null order by kind`);
  const s = Object.fromEntries(seeds.map(x => [x.kind, x]));
  ok('to start: a player PDF at £15 once and a club PDF once, on sale; the Manager pass at £1 a month',
     s.player_pdf.price_pennies === 1500 && s.player_pdf.interval === 'once' && s.player_pdf.active && s.club_pdf.interval === 'once' &&
     s.manager.price_pennies === 100 && s.manager.interval === 'month', seeds);
  ok('...the report emails, the league and the Team analytics suite tier are there to be priced, not on sale until they are',
     !s.player_mail.active && !s.team_mail.active && !s.league_setup.active && seeds.some(x => x.kind === 'tier' && !x.active), seeds);
}

console.log('\nthe console');
let PRO, PRO_PLUS;
{
  PRO = (await as('admin', `select public.save_access_plan($1::jsonb) id`, [JSON.stringify({ name: 'Pro', price_pennies: 500, interval: 'month', kind: 'tier', sort: 1 })]))[0].id;
  PRO_PLUS = (await as('admin', `select public.save_access_plan($1::jsonb) id`, [JSON.stringify({ name: 'Pro plus', price_pennies: 1200, interval: 'month', kind: 'tier', sort: 2 })]))[0].id;
  ok('a platform administrator adds tiers with nothing ticked yet', !!PRO && !!PRO_PLUS);
  ok('...nobody else may', /platform administrator/.test(await err('fan', `select public.save_access_plan($1::jsonb)`, [JSON.stringify({ name: 'X', price_pennies: 1, interval: 'month' })]) || ''));
  const m = { gates: { events: 'tiers', shotZones: 'signin', csv: 'free', frontOffice: 'tiers', manager: 'tiers' },
              tiers: { [PRO]: ['events'], [PRO_PLUS]: ['events', 'frontOffice', 'playerReport'] } };
  ok('the matrix saved at once', (await as('admin', `select public.platform_save_matrix($1::jsonb) r`, [JSON.stringify(m)]))[0].r === 'saved');
  ok('...a section that is not a row of it refused', /no such section/.test(await err('admin', `select public.platform_save_matrix($1::jsonb)`, [JSON.stringify({ gates: { nope: 'free' } })]) || ''));
  ok('...and a stranger may not save it', /platform administrators/.test(await err('fan', `select public.platform_save_matrix('{}'::jsonb)`) || ''));
  const bad = await err('admin', `select public.save_access_plan($1::jsonb)`, [JSON.stringify({ kind: 'team_mail', name: 'Bad', price_pennies: 900, interval: 'month', mail_kinds: ['weekly'] })]);
  ok('a club\'s report emails send club reports, not the weekly player report', /club''?s report emails|game analyses/.test(bad || ''), bad);
  const tm = (await as('admin', `select public.save_access_plan($1::jsonb) id`, [JSON.stringify({ kind: 'team_mail', name: 'Game analyses', price_pennies: 900, interval: 'month', mail_kinds: ['games'], includes_tier: PRO })]))[0].id;
  const row = await one(`select kind, mail_kinds, includes_tier, "interval" from public.access_plans where id = $1`, [tm]);
  ok('...a club report emails tier saved with what it sends and the membership tier it comes with', row.kind === 'team_mail' && row.mail_kinds.join() === 'games' && row.includes_tier === PRO, row);
  const pdf = await one(`select id from public.access_plans where kind = 'player_pdf'`);
  await as('admin', `select public.save_access_plan($1::jsonb)`, [JSON.stringify({ id: pdf.id, price_pennies: 1800, interval: 'month' })]);
  ok('a PDF\'s price changed, and it stays paid once whatever is sent', (await one(`select price_pennies p, "interval" i from public.access_plans where id = $1`, [pdf.id])).i === 'once');
  await as('admin', `select public.save_access_plan($1::jsonb)`, [JSON.stringify({ id: pdf.id, price_pennies: 1500 })]);
  const pub = (await as('anon', `select public.access_plans_public() j`))[0].j;
  const pro = pub.find(p => p.id === PRO), tmp = pub.find(p => p.id === tm);
  ok('the price list: what each thing is and opens; a price stated here is enough to buy it; a product comes with its tier\'s sections',
     pro.kind === 'tier' && pro.purchasable === true && pro.privileges.join() === 'events' && tmp.privileges.join() === 'events' && tmp.includes_tier_name === 'Pro', [pro, tmp]);
  ok('...a free trial is a tier\'s only', tmp.trial_months === 0 && (await one(`select public.trial_months_for($1, $2) n`, [U.fan, tm])).n === 0);
  const wall = (await as('anon', `select public.access_wall() w`))[0].w;
  ok('every page reads the rows with their place, the tiers on sale with what they open, and each thing sold on its own',
     wall.gates.some(g => g.key === 'frontOffice' && g.category === 'club') && wall.tiers.map(t => t.name).join() === 'Pro,Pro plus' &&
     wall.products.player_pdf.price_pennies === 1500 && wall.products.manager.price_pennies === 100, [wall.tiers, wall.products]);
}

console.log('\nthe matrix decides');
const LG = (await one(`insert into public.leagues (slug, name) values ('tier-league', 'Tier League') returning id`)).id;
const TEAM = (await one(`insert into public.teams (league_id, name, slug) values ($1, 'Club', 'tier-club') returning id`, [LG])).id;
async function subscribe(who, plan, status, extra = {}) {
  const sub = 'sub_' + Math.random().toString(36).slice(2, 12);
  const r = await as('service', `select public.billing_apply_subscription($1::jsonb, now()) r`, [JSON.stringify(Object.assign({
    user_id: U[who], plan_id: plan, status, stripe_subscription_id: sub, stripe_customer_id: 'cus_' + who,
    current_period_end: new Date(Date.now() + 20 * 864e5).toISOString() }, extra))]);
  return { sub, r: r[0].r };
}
{
  await switchOn(false);
  ok('memberships switched off: every section open to anybody, signed out too', (await as('anon', `select public.gate_open('events', $1) a, public.gate_open('frontOffice', $1) b`, [LG]))[0].a === true);
  await switchOn(true);
  const open = async (who, key, lg = LG) => (await as(who, `select public.gate_open($1, $2) o`, [key, lg]))[0].o;
  ok('switched on: Free open to everyone signed out', await open('anon', 'csv') === true);
  ok('...Signed in to any account, not to a reader signed out', await open('fan', 'shotZones') === true && await open('anon', 'shotZones') === false);
  ok('...a tier\'s section shut to a fan without it', await open('fan', 'events') === false);
  await subscribe('member', PRO, 'active');
  ok('...open to whoever holds a tier that ticks it, and only what it ticks', await open('member', 'events') === true && await open('member', 'playerReport') === false);
  const tm = (await one(`select id from public.access_plans where name = 'Game analyses'`)).id;
  await subscribe('buyer', tm, 'active', { checkout_id: null });
  ok('a report subscription that comes with a tier opens that tier\'s sections while it runs', await open('buyer', 'events') === true);
  await as('admin', `select public.grant_tier('fan@example.test', $1, null, 'press pass')`, [PRO_PLUS]);
  ok('a tier given by email opens what it ticks', await open('fan', 'playerReport') === true && await open('fan', 'frontOffice', LG) === true);
  ok('staff hold every section: a platform administrator', await open('admin', 'playerReport') === true && await open('admin', 'manager') === true);
  const st = (await as('member', `select public.access_state(array[$1]::uuid[]) s`, [LG]))[0].s;
  ok('the page\'s one call carries the sections held, here and with no league', st.privileges.includes('events') && st.leagues[0].privileges.includes('events'), st);
  const setAnalytics = async v => { await q(`select set_config('epinoia.access_rpc', 'on', false)`); await q(`update public.leagues set analytics_access = $2 where id = $1`, [LG, v]); await q(`select set_config('epinoia.access_rpc', '', false)`); };
  await setAnalytics('free');
  ok('a league that keeps its analytics free opens the analytics sections there, not the reports', await open('stranger', 'events') === true && await open('stranger', 'playerReport') === false);
  await setAnalytics('inherit');
  /* a plan from before the matrix opens what its features opened, until it is ticked; then its ticks alone */
  const OLD = (await one(`insert into public.access_plans (name, features, price_pennies, "interval") values ('Old analytics', array['analytics'], 300, 'month') returning id`)).id;
  await subscribe('coach', OLD, 'active');
  ok('a plan from before the matrix, with nothing ticked, opens what its features opened', await open('coach', 'events') === true && await open('coach', 'shotZones', LG) === true);
  await as('admin', `select public.platform_save_matrix($1::jsonb)`, [JSON.stringify({ tiers: { [OLD]: ['wowy'] } })]);
  ok('...once ticked in the matrix, its ticks alone (unticking a section takes it away)', await open('coach', 'events') === false && await open('coach', 'wowy') === true);
  ok('a section\'s teaser words are saved with the gate the matrix gave it', (await as('admin', `select public.platform_set_gate('events', 'tiers', 'Events for members', null) r`))[0].r === 'saved' &&
     (await one(`select gate, title from public.access_gates where key = 'events'`)).title === 'Events for members');
}

console.log('\na PDF paid for once, drawn by the server');
{
  const plan = (await one(`select id from public.access_plans where kind = 'player_pdf'`)).id;
  const P = (await one(`insert into public.players (first_name, last_name, slug) values ('Sam', 'Smith', 'tier-sam-smith') returning id`)).id;
  const rec = p => as('service', `select public.billing_record_purchase($1::jsonb) r`, [JSON.stringify(p)]);
  const base = { user_id: U.fan, plan_id: plan, subject_id: P, subject_name: 'Sam Smith', amount_pennies: 1500, currency: 'gbp', stripe_session_id: 'cs_test_a1', stripe_payment_intent: 'pi_a1' };
  ok('a paid checkout recorded, once however often the webhook comes', (await rec(base))[0].r.recorded === true && (await rec(base))[0].r.recorded === false);
  ok('...nobody but the webhook may record one', /permission denied/.test(await err('fan', `select public.billing_record_purchase($1::jsonb)`, [JSON.stringify(base)]) || ''));
  let mine = (await as('fan', `select public.my_pdf_purchase('player_pdf', $1) c`, [P]))[0].c;
  ok('the buyer\'s PDF is a job for the report worker, not something opened in their browser; somebody else has none',
     mine && mine.state === 'queued' && mine.ready === false && !(await as('member', `select public.my_pdf_purchase('player_pdf', $1) c`, [P]))[0].c, mine);
  ok('...no browser can take a job, mark one drawn or mint the worker\'s ticket', /permission denied/.test(await err('fan', `select public.pdf_render_claim(5)`) || '') &&
     /permission denied/.test(await err('fan', `select public.pdf_render_done($1, 'x', 1, 't', null)`, [mine.id]) || '') &&
     /permission denied/.test(await err('anon', `select public.report_bot_ticket()`) || ''));
  const jobs = (await as('service', `select public.pdf_render_claim(5) j`))[0].j;
  ok('the worker takes it: what to draw (the player and their page) and whom to send it to', jobs.length === 1 && jobs[0].kind === 'player_pdf' && jobs[0].slug === 'tier-sam-smith' &&
     jobs[0].email === 'fan@example.test' && jobs[0].attempt === 1, jobs);
  ok('...and nobody takes it twice', (await as('service', `select public.pdf_render_claim(5) j`))[0].j.length === 0);
  ok('...a failed drawing goes back in the queue while it has tries left', (await as('service', `select public.pdf_render_failed($1, 'the page timed out') s`, [jobs[0].id]))[0].s === 'queued');
  const again = (await as('service', `select public.pdf_render_claim(5) j`))[0].j;
  const path = U.fan + '/pdf/2026-10-16/epinoia-player-report-sam-smith.pdf';
  ok('drawn: kept as a file of the buyer\'s own', again.length === 1 && again[0].attempt === 2 &&
     (await as('service', `select public.pdf_render_done($1, $2, 12345, 'Sam Smith', 'Player report') d`, [again[0].id, path]))[0].d === true, again);
  mine = (await as('fan', `select public.my_pdf_purchase('player_pdf', $1) c`, [P]))[0].c;
  const dash = (await as('fan', `select public.my_reports(20) r`))[0].r;
  ok('...ready, in the buyer\'s dashboard, readable by the buyer alone', mine.ready === true && dash.linked === true && dash.files.some(f => f.kind === 'player_pdf' && f.path === path) &&
     (await as('fan', `select public.report_path_mine($1) m`, [path]))[0].m === true && (await as('member', `select public.report_path_mine($1) m`, [path]))[0].m === false &&
     (await as('member', `select public.my_reports(20) r`))[0].r.files.length === 0, dash);
  await rec(Object.assign({}, base, { stripe_session_id: 'cs_test_a2', stripe_payment_intent: 'pi_a2' }));
  ok('a refund takes a PDF not yet drawn out of the queue', (await as('service', `select public.billing_refund_purchase('pi_a2') n`))[0].n === 1 &&
     (await as('service', `select public.pdf_render_claim(5) j`))[0].j.length === 0);
  const acc = (await as('fan', `select public.my_access() a`))[0].a;
  ok('...and the account page lists what was bought', acc.purchases.length === 2, acc.purchases);
  const ticket = (await as('service', `select public.report_bot_ticket() t`))[0].t;
  ok('the worker\'s page is unlocked only by a ticket the database made: a made-up one opens nothing',
     ticket.length === 64 && (await as('anon', `select public.report_bot_ok($1) o`, [ticket]))[0].o === true &&
     (await as('anon', `select public.report_bot_ok($1) o`, ['x'.repeat(64)]))[0].o === false && (await as('anon', `select public.report_bot_ok('true') o`))[0].o === false);
  ok('...and a reader cannot read the tickets', /permission denied/.test(await err('fan', `select * from public.report_bot_tickets`) || ''));
  ok('the page knows whether the reader is a platform administrator (the access preview switch is theirs alone)',
     (await as('admin', `select public.access_state(null) s`))[0].s.platform_admin === true && (await as('fan', `select public.access_state(null) s`))[0].s.platform_admin === false);
  let once = null;
  try { await q(`insert into public.access_plans (kind, name, features, price_pennies, "interval") values ('tier', 'x', '{}', 1, 'once')`); } catch (e) { once = e.message; }
  ok('a one-off price is refused for anything but a PDF (the table says so, whoever writes)', /access_plans_once_ck/.test(once || ''), once);
}

console.log('\na subscription that builds');
{
  const checkout = async (who, plan, details) => (await one(`insert into public.access_checkouts (user_id, plan_id, consent_version, acknowledged_at, adult_confirmed, details)
                                                       values ($1, $2, '2026-09-a', now(), true, $3::jsonb) returning id`, [U[who], plan, JSON.stringify(details)])).id;
  const tm = (await one(`select id from public.access_plans where name = 'Game analyses'`)).id;
  const ck = await checkout('coach', tm, { team_id: TEAM, email: 'Coach.Inbox@example.test', name: 'Sam', tz: 'Europe/London' });
  const a = await subscribe('coach', tm, 'active', { checkout_id: ck });
  let row = await one(`select email, active, send_games, send_opponents, send_own, player_zip, user_id, access_subscription_id from public.report_mail_subs where team_id = $1`, [TEAM]);
  ok('paid: the club\'s report emails added, to the address given, sending what the tier sends', row && row.active && row.email === 'coach.inbox@example.test' &&
     row.send_games && !row.send_opponents && !row.send_own && !row.player_zip && row.user_id === U.coach, row);
  await as('service', `select public.billing_apply_subscription($1::jsonb, now() + interval '1 minute')`, [JSON.stringify({ stripe_subscription_id: a.sub, status: 'canceled',
    current_period_end: new Date().toISOString(), stripe_customer_id: 'cus_coach' })]);
  row = await one(`select active from public.report_mail_subs where team_id = $1`, [TEAM]);
  ok('...ended: switched off', row.active === false);

  const pm = (await as('admin', `select public.save_access_plan($1::jsonb) id`, [JSON.stringify({ kind: 'player_mail', name: 'Player weekly + match-ups', price_pennies: 400, interval: 'month', mail_kinds: ['weekly', 'matchups'] })]))[0].id;
  const P = (await one(`insert into public.players (first_name, last_name, slug) values ('Ann', 'Ace', 'tier-ann-ace') returning id`)).id;
  await subscribe('fan', pm, 'active', { checkout_id: await checkout('fan', pm, { player_id: P, tz: 'Europe/Paris' }) });
  const pr = await one(`select email, active, send_matchups, tz from public.report_mail_players where player_id = $1`, [P]);
  ok('a player\'s report emails added to the buyer\'s own address when none is given, with the match-ups the tier sends', pr && pr.active && pr.email === 'fan@example.test' && pr.send_matchups && pr.tz === 'Europe/Paris', pr);

  const ls = (await one(`select id from public.access_plans where kind = 'league_setup'`)).id;
  const lc = await checkout('buyer', ls, { league_name: 'Sunday Hoops', slug: 'tier-league', colour: '#123456' });
  const L = await subscribe('buyer', ls, 'active', { checkout_id: lc });
  const built = (await as('buyer', `select public.my_paid_leagues() j`))[0].j[0];
  const lg = await one(`select id, slug, name, visibility, colour_a from public.leagues where id = $1`, [built.league_id]);
  ok('a league paid for: built, private, its address made free of the one taken, its season ready', lg && lg.visibility === 'private' && lg.name === 'Sunday Hoops' &&
     lg.slug !== 'tier-league' && /^tier-league-/.test(lg.slug) && lg.colour_a === '#123456' &&
     !!(await one(`select 1 x from public.seasons where league_id = $1`, [lg.id])), [built, lg]);
  ok('...its buyer administers it', (await as('buyer', `select public.is_league_admin($1) a`, [lg.id]))[0].a === true);
  await as('service', `select public.billing_apply_subscription($1::jsonb, now() + interval '1 minute')`, [JSON.stringify({ stripe_subscription_id: L.sub, status: 'canceled',
    current_period_end: new Date().toISOString(), stripe_customer_id: 'cus_buyer' })]);
  const lapsed = await one(`select visibility, setup_lapsed_at from public.leagues where id = $1`, [lg.id]);
  ok('...lapsed: the buyer administers it no more, and it stays private, marked lapsed', (await as('buyer', `select public.is_league_admin($1) a`, [lg.id]))[0].a === false &&
     lapsed.visibility === 'private' && !!lapsed.setup_lapsed_at, lapsed);
  await as('service', `select public.billing_apply_subscription($1::jsonb, now() + interval '2 minutes')`, [JSON.stringify({ stripe_subscription_id: L.sub, status: 'active',
    current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(), stripe_customer_id: 'cus_buyer' })]);
  ok('...paid again: the same league, administered again, no longer lapsed', (await as('buyer', `select public.is_league_admin($1) a`, [lg.id]))[0].a === true &&
     !(await one(`select setup_lapsed_at from public.leagues where id = $1`, [lg.id])).setup_lapsed_at &&
     (await one(`select count(*)::int n from public.leagues where name = 'Sunday Hoops'`)).n === 1);
  const bad = await checkout('stranger', ls, { league_name: 'x' });
  const B = await subscribe('stranger', ls, 'active', { checkout_id: bad });
  const brow = await one(`select status, provision_error from public.access_subscriptions where stripe_subscription_id = $1`, [B.sub]);
  ok('a league that cannot be built keeps the payment and says why on the row', B.r.applied === true && brow.status === 'active' && /name/.test(brow.provision_error || ''), brow);
  const admin = (await as('admin', `select public.platform_access_admin() j`))[0].j;
  ok('...which the console lists with everything built', admin.built.some(b => b.error && /name/.test(b.error)) && admin.built.some(b => b.provision && b.provision.league_id) && admin.totals.pdfs_sold >= 1, admin.built.length);
  ok('a league address is checked as it is typed', (await as('anon', `select public.league_slug_free('tier-league') a, public.league_slug_free('brand-new') b, public.league_slug_free('Bad Slug') c`))
     .every(r => r.a === false && r.b === true && r.c === false));
}

console.log('\nthe front office and Manager mode');
{
  await q(`insert into public.memberships (user_id, role, scope_type, scope_id) values ($1, 'team_manager', 'team', $2)`, [U.coach, TEAM]);
  const fo = async who => (await as(who, `select public.front_office_access($1) a`, [TEAM]))[0].a;
  ok('the front office: signed out asked to sign in; a fan who is not the club\'s told it is the club\'s', await fo('anon') === 'signin' && await fo('stranger') === 'staff');
  ok('...the club\'s own manager without a tier that opens it asked to join', await fo('coach') === 'members');
  await as('admin', `select public.grant_tier('coach@example.test', $1, null, null)`, [PRO_PLUS]);
  ok('...with one (Pro plus ticks it), open; a platform administrator always', await fo('coach') === 'ok' && await fo('admin') === 'ok');
  await switchOn(false);
  ok('...and open to all while memberships are switched off, as before', await fo('anon') === 'ok');
  await switchOn(true);
  ok('Manager mode by tier: shut to a fan without the pass', (await as('stranger', `select public.gate_open('manager', null) o`))[0].o === false);
  const pass_ = (await one(`select id from public.access_plans where kind = 'manager'`)).id;
  await subscribe('stranger', pass_, 'active');
  ok('...open with the Manager pass', (await as('stranger', `select public.gate_open('manager', null) o`))[0].o === true);
  ok('...and a fan\'s clubs are written only while it is open (the trigger on manager_teams)', !!(await one(`select 1 x from pg_trigger where tgname = 'manager_teams_gate'`)));
}

console.log('\nthe console, the report tab, the front office and Manager mode (the pages\' side)');
{
  const { readFileSync } = await import('node:fs');
  const pathM = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const R = (...p) => readFileSync(pathM.join(pathM.dirname(fileURLToPath(import.meta.url)), '..', '..', ...p), 'utf8');
  const PJ = R('epinoia', 'admin', 'platform', 'platform.js'), PH = R('epinoia', 'admin', 'platform', 'index.html'), UI = R('epinoia', 'admin', 'access-ui.js');
  ok('the Plans tab: Who gets what, Sold on their own, Built and sold', ['plMatrix', 'plProducts', 'plBuilt'].every(id => PH.includes('id="' + id + '"')) &&
     /drawMatrix\(\);\n\s*drawProducts\(\);\n\s*drawBuilt\(\);/.test(PJ));
  ok('...the matrix: Free, Signed in, then each tier in its order; Free or Signed in covers the columns to its right; saved at once',
     /th\('Free', 'everyone'\);\n\s*th\('Signed in', 'a free account'\);/.test(PJ) && /b\.disabled = g === 'free' \|\| g === 'signin';/.test(PJ) &&
     /rpc\('platform_save_matrix', \{ p: payload \}\)/.test(PJ) && /Open ' \+ freed\.map\(label\)\.join\(', '\) \+ ' to everyone, signed out too\?'/.test(PJ));
  ok('...a new tier is a column (the plan form without features: what it opens is ticked in the matrix)', /matrix: !!\(plans && plans\.matrix\)/.test(PJ) &&
     /if \(o\.matrix\) \{ delete payload\.features; if \(!p\.id\) payload\.kind = 'tier'; \}/.test(UI));
  ok('...each thing sold on its own priced, on sale or not, with a tier or not, its emails ticked; as many email tiers as wanted',
     ["'player_pdf'", "'club_pdf'", "'manager'", "'player_mail'", "'team_mail'", "'league_setup'"].every(k => PJ.includes('[' + k)) &&
     /includes_tier: tier\.value \|\| ''/.test(PJ) && /payload\.mail_kinds = MAIL_KINDS\[kind\]/.test(PJ) && /'add another tier'/.test(PJ));
  ok('...a tier given by email', /rpc\('grant_tier', \{ p_email: e, p_plan: tierId,/.test(PJ));
  const RJ = R('epinoia', 'report.js'), TJ = R('epinoia', 't', 'team.js'), PL = R('epinoia', 'p', 'player.js'), MA = R('epinoia', 'manager', 'app.js');
  ok('the report tab, locked: a preview of its first three pages, built no further (nothing past them is computed), no legend, nothing to download',
     /const PREVIEW = o\.lock && Number\.isFinite\(o\.lock\.preview\) \? Math\.max\(0, o\.lock\.preview\) : 3;/.test(RJ) &&
     /if \(state\.preview && pagesNew\.querySelectorAll\('\.rp-pg'\)\.length > state\.preview\) break;/.test(RJ) &&
     /const lg = state\.preview \? null : o\.modules\.find/.test(RJ) && /if \(state\.preview\) \{\s*outs\.hidden = true;/.test(RJ));
  ok('...where the lock is a paid one, its PDF to buy (drawn by the server, never opened in the browser), or where the one bought has got to',
     /'Buy this report as a PDF'/.test(RJ) && /const paid = why\(\) !== 'signin';/.test(RJ) && /AX\(\)\.pdfPurchase\(pdf\.kind, pdf\.subject\)/.test(RJ) &&
     !/usePdfCredit|state\.credit|paidOnly/.test(RJ));
  ok('...the report worker\'s page unlocked only on a ticket the server checks (report_bot_ok), never on the flag alone',
     /const lockedNow = \(\) => state\.bot !== true && /.test(RJ) && /\/rest\/v1\/rpc\/report_bot_ok/.test(RJ) && !/!root\.EPINOIA_RP_BOT && !!\(o\.lock/.test(RJ) &&
     /root\.EPINOIA_RP_BOT && state\.bot === true\) root\.__rpPages/.test(RJ));
  const AJ = R('epinoia', 'access.js');
  ok('the access answers fixed in place: frozen, a window property that cannot be replaced', /Object\.defineProperty\(root, 'EpinoiaAccess', \{ value: Object\.freeze\(api\), writable: false, configurable: false/.test(AJ));
  ok('...the preview switch opens nothing for a reader who is not a platform administrator', /e\.st\.platformAdmin === true\) return 'member';/.test(AJ));
  ok('...a paid section, with memberships on, never says "an account is free" (the membership card, its own sign-in link)',
     /if \(k != null && gateOf\(k\) !== 'signin' && membershipsOn\(\)\) return false;/.test(AJ));
  ok('...the player\'s and the club\'s report each name what their PDF is of', /pdf: \{ kind: 'player_pdf', subject: pl\.id, name \}/.test(PL) && /pdf: \{ kind: 'club_pdf', subject: team\.id, name: team\.name \}/.test(TJ));
  ok('the front office asks the database who may open it, signed out too; an error shuts it while memberships are on; the old rule only before 0279',
     /\/rest\/v1\/rpc\/front_office_access/.test(TJ) && /if \(r\.status === 404\) return null;/.test(TJ) && /if \(fa === 'staff'\)/.test(TJ) && /if \(!fa && !frontOfficeOpen\(team\)\)/.test(TJ));
  ok('...its preview: the depth chart, its positions shut; the card where the GM view would be', /async function frontOfficePreview\(team, hostD\)/.test(TJ) &&
     /X\.chartHTML\(c, \{ link, static: true \}\)/.test(TJ) && /const hostCard = shown && hostG \? hostG : hostD;/.test(TJ));
  ok('Manager mode: a paid door when the matrix shuts it, the leaderboards open', /if \(A\.locked && !open\.includes\(name\)\) return paidDoor\(main\);/.test(MA) && /'Manager mode is for members'/.test(MA));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
