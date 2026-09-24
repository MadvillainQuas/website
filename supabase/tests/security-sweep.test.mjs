/* ============================================================================
   THE 2026-09-24 SECURITY SWEEP STAYS SWEPT (migration 0171).

   0171 closed gaps that a later migration can reopen without anybody noticing,
   because each one is "re-create this function / view / policy from an older
   copy". So this checks the LATEST definition of each, in whatever migration
   comes last, still carries the fix:

     * player_season_stats masks a withheld player's name;
     * game_officials_list shows an email only to whoever typed it;
     * officials_for_game asks whether the caller may score or run the game;
     * games_create is not open to every account;
     * a roster entry is inserted only for a player the caller may roster;
     * a media row arrives pending.

   And one thing 0171 made fail-closed on purpose: players has no table-wide
   SELECT for the API roles any more (a guardian's name is not public), so a
   column ADDED to players later must be granted by name in the same file, or
   every page that selects it is refused.

   Plus the pages: nothing asks PostgREST for players?select=* (the refused
   columns are part of *), and the API names no minor.

     node supabase/tests/security-sweep.test.mjs
   ============================================================================ */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d === undefined ? '' : '\n          ' + JSON.stringify(d))); } };

const MIG = path.join('supabase', 'migrations');
const files = readdirSync(path.join(ROOT, MIG)).filter(f => f.endsWith('.sql')).sort();
const sweep = files.find(f => f.startsWith('0171_')) || '';
ok('0171 is there', !!sweep);

/* the newest definition of an object: a function to its closing $$;, a view to its ;,
   a policy to its ; (policies are dropped and re-created, so the last create wins) */
function latest(kind, name) {
  for (const f of [...files].reverse()) {
    const sql = rd(MIG, f);
    const head = kind === 'view' ? 'create or replace view public.' + name + ' as'
      : kind === 'policy' ? 'create policy ' + name + ' on '
      : 'create or replace function public.' + name + '(';
    const at = sql.lastIndexOf(head);
    if (at < 0) continue;
    const end = sql.indexOf(kind === 'function' ? '$$;' : ';', at);
    return { file: f, text: end < 0 ? '' : sql.slice(at, end) };
  }
  return { file: '', text: '' };
}
const tag = o => o.file.slice(0, 4) || '?';

{
  const v = latest('view', 'player_season_stats');
  ok('the latest player_season_stats (' + tag(v) + ') masks a withheld player\'s name',
     /may_see_withheld_player\(/.test(v.text) && /when w\.hide then null else p\.first_name/.test(v.text));
}
{
  const f = latest('function', 'game_officials_list');
  ok('the latest game_officials_list (' + tag(f) + ') shows an email only to whoever typed it',
     /action = 'assign_official'/.test(f.text) && !/select go\.user_id, u\.email::text, go\.role/.test(f.text));
}
{
  const f = latest('function', 'officials_for_game');
  ok('the latest officials_for_game (' + tag(f) + ') asks whether the caller may score or run the game',
     /may_score_game\(p_game\)/.test(f.text) && /can_manage_game\(p_game\)/.test(f.text));
}
{
  const p = latest('policy', 'games_create');
  ok('the latest games_create (' + tag(p) + ') is not open to every account',
     !!p.text && !/competition_id is null or/.test(p.text) && !/with check \(auth\.uid\(\) is not null\)\s*$/.test(p.text));
}
{
  const p = latest('policy', 'roster_insert');
  ok('the latest roster_insert (' + tag(p) + ') asks may_roster_player', /may_roster_player\(player_id\)/.test(p.text));
  const old = latest('policy', 'roster_write');
  ok('...and no later file brings back the old roster_write',
     !old.file || old.file < sweep, old.file);
}
{
  const p = latest('policy', 'media_insert');
  ok('the latest media_insert (' + tag(p) + ') only takes pending rows', /status = 'pending'/.test(p.text));
}

/* a column added to players after 0171 must be granted by name in the same file */
for (const f of files.filter(f => sweep && f > sweep)) {
  const sql = rd(MIG, f);
  const added = [...sql.matchAll(/alter table (?:public\.)?players\s+add column (?:if not exists )?([a-z_0-9]+)/gi)].map(m => m[1]);
  for (const col of added) {
    const granted = new RegExp('grant select \\([^)]*\\b' + col + '\\b[^)]*\\) on (?:table )?public\\.players to anon, authenticated', 'i').test(sql);
    ok(f + ' grants the new players column ' + col + ' by name', granted,
       'players has no table-wide SELECT since 0171: add  grant select (' + col + ') on public.players to anon, authenticated;');
  }
}

/* the pages: nothing asks for every column of players */
function walk(dir, out = []) {
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/^(vendor|node_modules|android|ios)$/.test(e.name)) walk(p, out); }
    else if (/\.(js|html)$/.test(e.name)) out.push(p);
  }
  return out;
}
const star = [];
for (const f of walk('epinoia').concat(walk('share'))) {
  const s = rd(f);
  if (/players\?[^'"`]*select=\*/.test(s) || /from\(['"]players['"]\)[^;]*?\.select\(\s*\)/.test(s) ||
      /from\(['"]players['"]\)[^;]*?\.select\(['"]\*['"]\)/.test(s) || /players\(\*\)/.test(s)) star.push(f);
}
ok('no page asks for players?select=* (a guardian\'s name is not a public column)', !star.length, star);

/* the API: a minor is never named */
{
  const api = rd('supabase', 'functions', 'api', 'index.ts');
  ok('the API\'s player() withholds a minor', /p\.is_minor \? \{ name: null/.test(api));
  const sel = [...api.matchAll(/players\(([^)]*)\)|from\('players'\)\.select\('([^']*)'\)/g)].map(m => m[1] || m[2]);
  ok('...and every players select that feeds it asks for is_minor', sel.length > 0 && sel.every(s => /\bis_minor\b/.test(s)), sel);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
