'use strict';
/* ============================================================================
   STORYLINES (the creator hub, 0200).   window.EpinoiaStorylines

   Key numbers from one competition, each put as a line a creator can build a piece around: who is top and by how
   much, the race at the play-off line (or the bunch at the top), the longest winning and losing runs, the scoring,
   rebounding and assists leaders, the season's single-game highs, form over the last five, the latest upset, the
   biggest game coming up, a milestone in reach, and the league's scoring. Each is a card: a kicker, a headline, the
   numbers under it, and the same as plain text to copy.

   Pure: the page reads the numbers (creators/hub/hub.js) and this turns them into words, so node can test it.

     build({ comp, standings, teams, leaders, records, results, fixtures, now, fmt }) -> [{ key, kicker, head, lines, copy }]
       standings  [{ team_id, rank, gp, w, l, streak, group_name, pts_for, pts_against }]
       teams      Map(id -> { name, short_name })
       leaders    { ppg: [], rpg: [], apg: [], totals: [] } - rows of player_season_stats
                  { first_name, last_name, team_short, gp, pts, ppg, rpg, apg }, best first
       records    records.js's { player: [{ cat: { k }, v, meta: { name }, game, oppId }] } or null
       results    finished games, newest first: { tipoff_at, home_team_id, away_team_id, home_score, away_score }
       fixtures   games to come, soonest first: { tipoff_at, home_team_id, away_team_id }
       fmt        (date, withTime) -> text; the reader's own by default
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaStorylines = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

function ord(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
/* games behind: (wins apart + losses apart) / 2, halves as ½ */
function gb(a, b) { return ((a.w - b.w) + (b.l - a.l)) / 2; }
function half(x) {
  const whole = Math.floor(x), h = x - whole >= 0.5;
  return (whole ? String(whole) : h ? '' : '0') + (h ? '½' : '');
}
const games = n => (n === 1 ? 'one game' : half(n) + ' games');
const one = x => (Math.round(x * 10) / 10).toFixed(1);
const nameOf = r => [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || 'A player';
const rec = s => s.w + '-' + s.l;
const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b);

function build(d) {
  const o = d || {};
  const now = o.now instanceof Date ? o.now : new Date();
  const fmt = typeof o.fmt === 'function' ? o.fmt
    : (t, withTime) => new Date(t).toLocaleString('en-GB', withTime ? { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
                                                             : { weekday: 'short', day: 'numeric', month: 'short' });
  const teams = o.teams instanceof Map ? o.teams : new Map();
  const T = id => (teams.get(id) || {}).name || 'A club';
  const out = [];
  const card = (key, kicker, head, lines) => {
    const ls = lines.filter(Boolean).map(x => x.charAt(0).toUpperCase() + x.slice(1));
    out.push({ key, kicker, head, lines: ls, copy: [head].concat(ls).join('\n') });
  };

  /* THE TABLE: its first group, or each group's leader */
  const played = (o.standings || []).filter(s => s && s.gp > 0 && s.team_id);
  const groups = [...new Set(played.map(s => s.group_name || ''))];
  const inGroup = g => played.filter(s => (s.group_name || '') === g).sort((a, b) => a.rank - b.rank);
  const table = inGroup(groups[0] || '');
  const rankOf = new Map();
  if (groups.length === 1) table.forEach(s => rankOf.set(s.team_id, s.rank));
  const maxGp = played.reduce((m, s) => Math.max(m, s.gp), 0);

  if (groups.length > 1) {
    card('top', 'The table', 'The group leaders', groups.map(g => { const t = inGroup(g)[0]; return t ? (g || 'Group') + ': ' + T(t.team_id) + ' (' + rec(t) + ')' : null; }));
  } else if (table.length >= 2) {
    const a = table[0], b = table[1], gap = gb(a, b);
    card('top', 'The table', T(a.team_id) + ', top of the table', [
      rec(a) + ' after ' + plural(a.gp, 'game', 'games'),
      gap > 0 ? games(gap) + ' clear of ' + T(b.team_id) + ' (' + rec(b) + ')' : 'Level with ' + T(b.team_id) + ' (' + rec(b) + '), ahead on the tie-break'
    ]);
  }

  /* THE RACE: at the play-off line where the competition has one, else the bunch at the top */
  if (groups.length === 1 && maxGp >= 3) {
    const q = (o.comp && o.comp.qualifiers) | 0;
    if (q >= 2 && table.length > q) {
      const inn = table[q - 1], outt = table[q], gap = gb(inn, outt);
      const near = table.filter((s, i) => i >= q && gb(inn, s) <= 1).length;
      card('race', 'The race', 'The race for ' + ord(q), [
        T(inn.team_id) + ' hold ' + ord(q) + ' at ' + rec(inn),
        gap > 0 ? T(outt.team_id) + ' ' + games(gap) + ' behind, in ' + ord(q + 1) : T(outt.team_id) + ' level, out on the tie-break',
        near > 1 ? near + ' teams within a game of the line' : null
      ]);
    } else {
      const lead = table[0], bunch = table.filter(s => gb(lead, s) <= 1);
      if (bunch.length >= 3) {
        card('race', 'The race', plural(bunch.length, 'team', 'teams') + ' within a game of the top',
             bunch.slice(0, 5).map(s => ord(s.rank) + ' ' + T(s.team_id) + ' (' + rec(s) + ')'));
      }
    }
  }

  /* RUNS: the longest winning and losing streaks, three at least */
  const runs = played.map(s => { const m = /^([WL])(\d+)$/.exec(String(s.streak || '')); return m ? { s, w: m[1] === 'W', n: +m[2] } : null; }).filter(Boolean);
  const bestW = runs.filter(r => r.w && r.n >= 3).sort((a, b) => b.n - a.n)[0];
  const bestL = runs.filter(r => !r.w && r.n >= 3).sort((a, b) => b.n - a.n)[0];
  if (bestW || bestL) {
    card('streaks', 'Streaks', bestW ? T(bestW.s.team_id) + ': ' + bestW.n + ' wins in a row' : T(bestL.s.team_id) + ': ' + bestL.n + ' defeats in a row', [
      bestW ? 'The longest winning run in the league, ' + rec(bestW.s) + ' overall' : null,
      bestW && bestL ? 'At the other end, ' + T(bestL.s.team_id) + ' have lost ' + bestL.n + ' straight' : null,
      !bestW && bestL ? 'The longest losing run in the league, ' + rec(bestL.s) + ' overall' : null
    ]);
  }

  /* LEADERS */
  const L = o.leaders || {};
  const top = (k) => (L[k] || [])[0];
  const p1 = top('ppg');
  if (p1) {
    const r2 = (L.ppg || [])[1];
    card('leaders', 'Leaders', nameOf(p1) + ' leads the scoring', [
      one(p1.ppg) + ' points a game' + (p1.team_short ? ' for ' + p1.team_short : '') + ' (' + plural(p1.gp, 'game', 'games') + ')',
      r2 ? 'Next: ' + nameOf(r2) + ', ' + one(r2.ppg) : null,
      top('rpg') ? 'Rebounds: ' + nameOf(top('rpg')) + ', ' + one(top('rpg').rpg) + ' a game' : null,
      top('apg') ? 'Assists: ' + nameOf(top('apg')) + ', ' + one(top('apg').apg) + ' a game' : null
    ]);
  }

  /* SEASON HIGHS, from records.js */
  const pr = (o.records && o.records.player) || [];
  const hi = k => pr.find(r => r && r.cat && r.cat.k === k && r.meta && r.meta.name);
  const hp = hi('pts');
  if (hp) {
    card('highs', 'Season highs', hp.v + ' points: ' + hp.meta.name, [
      (hp.oppId ? 'Against ' + T(hp.oppId) : 'In one game') + (hp.game && hp.game.tipoff_at ? ', ' + fmt(hp.game.tipoff_at) : ''),
      hp.shared > 1 ? 'Shared by ' + hp.shared + ' players' : null,
      hi('reb') ? 'Rebounds: ' + hi('reb').v + ', ' + hi('reb').meta.name : null,
      hi('ast') ? 'Assists: ' + hi('ast').v + ', ' + hi('ast').meta.name : null
    ]);
  }

  /* FORM: the last five of each club */
  const results = (o.results || []).filter(g => g && g.home_score != null && g.away_score != null && g.home_score !== g.away_score);
  const form = new Map();
  results.forEach(g => {
    [[g.home_team_id, g.home_score > g.away_score], [g.away_team_id, g.away_score > g.home_score]].forEach(([id, won]) => {
      if (!id) return;
      if (!form.has(id)) form.set(id, []);
      const f = form.get(id);
      if (f.length < 5) f.push(won ? 'W' : 'L');
    });
  });
  const five = [...form.entries()].filter(([, f]) => f.length === 5).map(([id, f]) => ({ id, f, w: f.filter(x => x === 'W').length }));
  const hot = five.filter(x => x.w >= 4).sort((a, b) => b.w - a.w)[0];
  const cold = five.filter(x => x.w <= 1).sort((a, b) => a.w - b.w)[0];
  if (hot || cold) {
    card('form', 'Form', hot ? T(hot.id) + ': ' + hot.w + ' wins from the last 5' : T(cold.id) + ': ' + cold.w + ' ' + (cold.w === 1 ? 'win' : 'wins') + ' from the last 5', [
      hot ? 'Newest first: ' + hot.f.join(' ') : 'Newest first: ' + cold.f.join(' '),
      hot && cold ? 'Coldest: ' + T(cold.id) + ', ' + cold.f.join(' ') : null
    ]);
  }

  /* THE LATEST UPSET: a winner four places or more below the loser, in the last fortnight */
  if (rankOf.size && maxGp >= 3) {
    const since = now.getTime() - 14 * 86400e3;
    const ups = results.filter(g => new Date(g.tipoff_at).getTime() >= since).map(g => {
      const homeWon = g.home_score > g.away_score;
      const w = homeWon ? g.home_team_id : g.away_team_id, l = homeWon ? g.away_team_id : g.home_team_id;
      return { g, w, l, rw: rankOf.get(w), rl: rankOf.get(l) };
    }).filter(u => u.rw && u.rl && u.rw - u.rl >= 4).sort((a, b) => (b.rw - b.rl) - (a.rw - a.rl));
    const u = ups[0];
    if (u) {
      const hs = u.g.home_score, as = u.g.away_score;
      card('upset', 'Upset', T(u.w) + ' (' + ord(u.rw) + ') beat ' + T(u.l) + ' (' + ord(u.rl) + ')', [
        T(u.g.home_team_id) + ' ' + hs + '-' + as + ' ' + T(u.g.away_team_id) + ', ' + fmt(u.g.tipoff_at)
      ]);
    }
  }

  /* THE BIG GAME: the two best-placed clubs to meet in the next fortnight, both in the top half */
  if (rankOf.size && maxGp >= 2) {
    const until = now.getTime() + 14 * 86400e3, halfWay = Math.ceil(table.length / 2);
    const big = (o.fixtures || []).filter(g => g && new Date(g.tipoff_at).getTime() >= now.getTime() && new Date(g.tipoff_at).getTime() <= until)
      .map(g => ({ g, a: rankOf.get(g.home_team_id), b: rankOf.get(g.away_team_id) }))
      .filter(x => x.a && x.b && x.a <= halfWay && x.b <= halfWay)
      .sort((x, y) => (x.a + x.b) - (y.a + y.b) || new Date(x.g.tipoff_at) - new Date(y.g.tipoff_at))[0];
    if (big) {
      card('big', 'Coming up', T(big.g.home_team_id) + ' v ' + T(big.g.away_team_id), [
        ord(big.a) + ' against ' + ord(big.b), fmt(big.g.tipoff_at, true)
      ]);
    }
  }

  /* A MILESTONE IN REACH: a season's points total within twenty of the next hundred (two hundred and up) */
  const ms = (L.totals || []).map(r => {
    const next = Math.floor((r.pts || 0) / 100) * 100 + 100;
    return { r, next, need: next - (r.pts || 0) };
  }).filter(x => x.r.pts >= 180 && x.need <= 20).sort((a, b) => a.need - b.need || b.r.pts - a.r.pts)[0];
  if (ms) {
    card('milestone', 'Milestone', nameOf(ms.r) + ': ' + ms.need + ' points from ' + ms.next, [
      ms.r.pts + ' this season in ' + plural(ms.r.gp, 'game', 'games') + ' (' + one(ms.r.ppg) + ' a game)'
    ]);
  }

  /* THE LEAGUE'S SCORING */
  const scored = played.filter(s => s.pts_for != null && s.pts_against != null && s.gp > 0);
  if (scored.length >= 2 && maxGp >= 2) {
    const g2 = scored.reduce((m, s) => m + s.gp, 0);
    const avg = scored.reduce((m, s) => m + s.pts_for, 0) / g2;
    const att = scored.slice().sort((a, b) => b.pts_for / b.gp - a.pts_for / a.gp)[0];
    const def = scored.slice().sort((a, b) => a.pts_against / a.gp - b.pts_against / b.gp)[0];
    card('numbers', 'The numbers', 'Teams score ' + one(avg) + ' points a game', [
      'Best attack: ' + T(att.team_id) + ', ' + one(att.pts_for / att.gp),
      'Best defence: ' + T(def.team_id) + ', ' + one(def.pts_against / def.gp) + ' allowed'
    ]);
  }
  return out;
}

return { build, ord, gb, half };
}));
