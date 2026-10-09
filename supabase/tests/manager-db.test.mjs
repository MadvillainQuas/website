// MANAGER MODE'S DATABASE (0259) on a real Postgres (PGlite): every migration applied, then the clubs, their names,
// their sizes, the boards, the badges, the continental boosts and the platform's value editor, as the readers who use
// them. Skips when PGlite is not installed (PGLITE_DIR=<its folder> or `npm i --no-save @electric-sql/pglite`).
//   node supabase/tests/manager-db.test.mjs
import { allMigrations } from './pg-all-migrations.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); } };

const T0 = Date.now();
const built = await allMigrations({ before: '0260' });
if (!built) { console.log('SKIP  @electric-sql/pglite is not installed'); process.exit(0); }
const { db, failed } = built;
console.log(`every migration on PGlite (${((Date.now() - T0) / 1000).toFixed(1)} s)`);
ok('they all apply, 0259 among them', failed.length === 0, failed);
const q = async (sql, params) => (await db.query(sql, params)).rows;

/* the fixture: a domestic league (two clubs), a continental competition with one of them linked, three fans and an
   administrator */
await db.exec(`
create table public.zz (k text primary key, id uuid not null);
do $fx$
declare lid uuid; sid uuid; cid uuid; eid uuid; esid uuid; ecid uuid; t1 uuid; t2 uuid; e1 uuid; g uuid; u uuid; i int;
begin
  insert into public.leagues (slug, name) values ('zz-dom', 'ZZ Domestic') returning id into lid;
  insert into public.seasons (league_id, name) values (lid, '2026-27') returning id into sid;
  insert into public.competitions (season_id, name) values (sid, 'ZZ League') returning id into cid;
  insert into public.leagues (slug, name) values ('zz-euro', 'ZZ Euro') returning id into eid;
  insert into public.seasons (league_id, name) values (eid, '2026-27') returning id into esid;
  insert into public.competitions (season_id, name) values (esid, 'ZZ Euro') returning id into ecid;
  insert into public.teams (league_id, slug, name, short_name) values (lid, 'zz-a', 'Alpha', 'ALP') returning id into t1;
  insert into public.teams (league_id, slug, name, short_name) values (lid, 'zz-b', 'Beta', 'BET') returning id into t2;
  insert into public.teams (league_id, slug, name, short_name) values (eid, 'zz-a-eu', 'Alpha', 'ALP') returning id into e1;
  insert into public.team_groups (name) values ('Alpha') returning id into g;
  insert into public.team_group_members (team_id, group_id) values (t1, g), (e1, g);
  insert into zz values ('lg', lid), ('cp', cid), ('eu', eid), ('ecp', ecid), ('t1', t1), ('t2', t2);
  for i in 1 .. 4 loop
    insert into auth.users (email) values ('mgr' || i || '@example.invalid') returning id into u;
    insert into zz values ('u' || i, u);
  end loop;
  insert into public.memberships (user_id, role, scope_type) select id, 'platform_admin', 'platform' from zz where k = 'u4';
end $fx$;`);
const FX = Object.fromEntries((await q('select k, id from zz')).map(r => [r.k, r.id]));
async function as(label, fn) {
  const role = label === 'anon' ? 'anon' : 'authenticated';
  const claims = label === 'anon' ? { role } : { sub: FX[label], role: 'authenticated' };
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
  await db.exec(`set role ${role}`);
  try { return await fn(); } finally { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claims', '', false)`); }
}
const tryq = async (sql, params) => { try { return { rows: await q(sql, params) }; } catch (e) { return { error: e.message }; } };

/* ---- creating clubs ---- */
const mk = (who, name, manager, badge) => as(who, () => tryq(`select public.manager_create($1, $2, $3, $4, $5::jsonb, 2) as id`,
  [FX.lg, FX.cp, name, manager, JSON.stringify(badge || { shape: 'shield', c1: '#1d4ed8' })]));
const a = await mk('u1', 'Utopia City', 'Louie');
ok('a fan makes a club', a.rows && a.rows[0] && a.rows[0].id, a);
const clubA = a.rows[0].id;
ok('signed out: no club', !!(await mk('anon', 'Nobody FC', 'Nobody')).error);
ok('a blocked word in the club name is refused (through the disguises: sh1t)', /club name: blocked/.test((await mk('u2', 'Sh1t Kickers', 'Pat')).error || ''));
ok('a blocked word in the manager name is refused', /manager name: blocked/.test((await mk('u2', 'Fine Club', 'Hitler')).error || ''));
ok('a name too short is refused', /short/.test((await mk('u2', 'A', 'Pat')).error || ''));
ok('characters outside letters, digits, spaces and . \' & - are refused', /characters/.test((await mk('u2', 'Club <b>', 'Pat')).error || ''));
ok('names in any alphabet are fine', !(await mk('u2', 'Ψ Αθήνα', 'Νίκος')).error);
ok('a badge image that is not a small data URL is refused', /badge/.test((await mk('u2', 'Img Club', 'Pat', { img: 'https://evil.example/x.png' })).error || ''));
ok('a league that does not hold the competition is refused', !!(await as('u2', () => tryq(`select public.manager_create($1, $2, 'Wrong Pair', 'Pat')`, [FX.eu, FX.cp]))).error);
await mk('u1', 'Second', 'Louie'); await mk('u1', 'Third', 'Louie');
ok('three clubs a fan at most', /three clubs/.test((await mk('u1', 'Fourth', 'Louie')).error || ''));

/* ---- saving ---- */
const save = (who, id, patch) => as(who, () => tryq(`select public.manager_save($1, $2::jsonb) as at`, [id, JSON.stringify(patch)]));
ok('the owner saves the squad and lineups', !(await save('u1', clubA, { status: 'active', budget: 1200000, roster: ['p1', 'p2'], lineups: [{ ids: ['p1', 'p2', 'p3', 'p4', 'p5'], min: 40 }] })).error);
ok('another fan cannot save it', /not your club/.test((await save('u2', clubA, { status: 'done' })).error || ''));
ok('a summary with more games than rounds is refused', /summary/.test((await save('u1', clubA, { summary: { w: 60, l: 0, pf: 5000, pa: 4000, pos: 1, of: 17, rounds: 51, played: 51 } })).error || ''));
ok('a table position outside the league is refused', /summary/.test((await save('u1', clubA, { summary: { w: 3, l: 1, pf: 330, pa: 300, pos: 18, of: 17, rounds: 51, played: 4 } })).error || ''));
ok('points beyond any game are refused', /summary/.test((await save('u1', clubA, { summary: { w: 1, l: 0, pf: 900, pa: 50, pos: 1, of: 17, rounds: 51, played: 1 } })).error || ''));
ok('a real summary is kept', !(await save('u1', clubA, { summary: { w: 3, l: 1, pf: 330, pa: 300, pos: 2, of: 17, rounds: 51, played: 4 }, state: { v: 1, fixtures: [] } })).error);
ok('more than four lineups is refused', /lineups/.test((await save('u1', clubA, { lineups: [1, 2, 3, 4, 5] })).error || ''));
ok('a state over the size limit is refused', !!(await save('u1', clubA, { state: { junk: Array.from({ length: 120000 }, (_, i) => 'k' + (i * 7919) % 1000003) } })).error);
const mine = await as('u1', () => q(`select name, w, l, gp, pos, status from public.manager_teams order by created_at`));
ok('a fan reads their own clubs', mine.length === 3 && mine[0].gp === 4 && mine[0].status === 'active', mine);
ok('and nobody else\'s', (await as('u2', () => q(`select count(*)::int n from public.manager_teams where user_id <> $1`, [FX.u2])))[0].n === 0);
ok('nobody writes the table directly', !!(await as('u1', () => tryq(`update public.manager_teams set w = 99`))).error);

/* ---- the boards ---- */
const b2 = (await mk('u3', 'Rivals', 'Sam', { shape: 'round', img: 'data:image/png;base64,iVBORw0KGgo=' })).rows[0].id;
await save('u3', b2, { status: 'active', summary: { w: 4, l: 0, pf: 360, pa: 300, pos: 1, of: 17, rounds: 51, played: 4 } });
const board = await as('anon', () => q(`select rank, name, manager, badge, has_img, league_slug, w, l, pct, diff, me from public.manager_leaderboard(null, 50)`));
ok('the board ranks by winning share', board.length === 2 && board[0].name === 'Rivals' && board[1].name === 'Utopia City' && +board[0].rank === 1, board);
ok('the board never carries the image itself, only that there is one', board[0].has_img === true && !('img' in board[0].badge), board[0]);
ok('a club that has not played is not on it', !board.some(r => r.name === 'Second'));
const meRow = await as('u1', () => q(`select name, me from public.manager_leaderboard($1, 50)`, [FX.lg]));
ok('`me` marks the reader\'s own club only', meRow.find(r => r.name === 'Utopia City').me === true && meRow.find(r => r.name === 'Rivals').me === false, meRow);
const imgs = await as('anon', () => q(`select id, img from public.manager_badges($1::uuid[])`, [[b2, clubA]]));
ok('the images come on their own, only for clubs on a board that have one', imgs.length === 1 && imgs[0].id === b2, imgs);
const lgs = await as('anon', () => q(`select league_slug, clubs::int from public.manager_board_leagues()`));
ok('the leagues with clubs on the boards', lgs.length === 1 && lgs[0].league_slug === 'zz-dom' && lgs[0].clubs === 2, lgs);
ok('a deleted club is gone', (await as('u3', () => q(`select public.manager_delete($1) as d`, [b2])))[0].d === true
  && (await as('anon', () => q(`select count(*)::int n from public.manager_leaderboard(null, 50)`)))[0].n === 1);

/* ---- the values editor and the boosts ---- */
ok('a fan cannot set values', /platform administrators only/.test((await as('u1', () => tryq(`select public.manager_set_values($1::jsonb)`, [JSON.stringify([{ league_id: FX.lg, min_value: 20000, max_value: 400000 }])]))).error || ''));
const set = await as('u4', () => tryq(`select public.manager_set_values($1::jsonb) as n`, [JSON.stringify([{ league_id: FX.lg, min_value: 20000, max_value: 400000 }, { league_id: FX.eu, min_value: 100000, max_value: 2000000, boost: 0.3 }])]));
ok('an administrator sets several leagues at once', set.rows && set.rows[0].n === 2, set);
ok('a range upside down is refused', !!(await as('u4', () => tryq(`select public.manager_set_values($1::jsonb)`, [JSON.stringify([{ league_id: FX.lg, min_value: 500000, max_value: 400000 }])]))).error);
const vals = await as('anon', () => q(`select league_id, min_value::int, max_value::int, boost::float from public.manager_league_values order by min_value`));
ok('anybody reads the values', vals.length === 2 && vals[0].min_value === 20000, vals);
const boosts = await as('anon', () => q(`select team_id, boost::float from public.manager_boosts($1)`, [FX.lg]));
ok('a club linked to a continental side takes its boost; the other club none', boosts.length === 1 && boosts[0].team_id === FX.t1 && boosts[0].boost === 0.3, boosts);
await as('u4', () => q(`select public.manager_set_values($1::jsonb)`, [JSON.stringify([{ league_id: FX.eu, min_value: null }])]));
ok('a range removed', (await as('anon', () => q(`select count(*)::int n from public.manager_league_values`)))[0].n === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
