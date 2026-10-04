'use strict';
/* ============================================================================
   THE PLAYER'S REPORT (report.js on the player profile, p/player.js reportTab): its modules.

     cover            his name, his club's crest, the title and subtitle, his position breakdown on a half court
     MAIN STATS       the stats of a template (by his position, or the reader's own), in groups, each against the
                      competition: value, percentile, bar, the field's average. RAPM on request (a button: every stint
                      of the league's season is read). Headline tiles over them.
     SHOT CHART       the zones court and every shot beside it, the zone table in the court's colours, the hot spots
     ON THE FLOOR     the team with him on and off, his own line, and his three best and three worst pairings
     LAST 7 DAYS      the old weekly report (weekly.js), off by default
     LEGEND           every statistic printed, defined

   ctx (from p/player.js): identity(), bars() -> {mine, field, gameIds}, pos() -> {pct, games, minutes},
   shots() -> {shots, games, colour, gameList}, floor() -> {stints, recs, meta, playerId, logs}, rapm(onProgress) ->
   Map(id -> {orapm, drapm, rapm}), week() -> the weekly report.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaReportPlayer = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const RP = () => root.EpinoiaReport;

function modules(ctx) {
  const E = RP();
  const { block, title, esc } = E;
  let posP = null;
  const pos = () => posP || (posP = Promise.resolve(ctx.pos ? ctx.pos() : null).catch(() => null));
  let group = 'guard';
  const RAPM = { map: null, running: false };
  const HC = { key: null, map: null };                       // the competition's half-court assists, once per set of games
  /* his Synergy profile (report.js synergyOf), where there is one */
  const synOf = async id => (E.synergyOf && id != null ? (await E.synergyOf([id]).catch(() => new Map())).get(String(id)) || null : null);

  /* ---------------- the cover ---------------- */
  const cover = {
    key: 'cover', title: 'Cover', on: true,
    async build(c) {
      const P = await pos();
      const NAMES = ['point guard', 'shooting guard', 'small forward', 'power forward', 'centre'];
      let main = '';
      if (P && P.pct) {
        group = E.posGroup(P.pct, c.listedPos);
        const k = P.pct.indexOf(Math.max(...P.pct));
        main = NAMES[k] + ' (' + Math.round(P.pct[k]) + '% of his minutes)';
      }
      const B = await Promise.resolve(ctx.bars ? ctx.bars() : null).catch(() => null);
      const m = B && B.mine;
      c.facts = [['Player', c.name], ['Club', c.club], ['Competition', c.scope], ['Position', main || c.listedPos || ''],
        ['Template', { guard: 'Guard', wing: 'Wing', big: 'Big' }[group] + ' (by position)'],
        ['Games', m && m.gp ? m.gp + ' played \u00b7 ' + (+m.mpg || 0).toFixed(1) + ' min a game' : '']];
      if (!P || !P.pct) return '<h4>Position breakdown</h4><div class="rp-empty">No minutes at a position on record yet.</div>';
      return '<h4>Position breakdown<span>' + P.games + (P.games === 1 ? ' game' : ' games') + ' \u00b7 ' + Math.round(P.minutes) + ' min</span></h4>' +
        E.posCourtHTML(P.pct) + E.POS_KEY;
    }
  };

  /* ---------------- MAIN STATS ---------------- */
  const main = {
    key: 'main', title: 'Main stats', page: 'MAIN STATS', on: true,
    controls(host, state) {
      E.templateControl(host, state, { set: 'main', label: 'main stats', pos: () => group });
      /* his Synergy file: added here, it goes in this report (and, for a platform administrator, every report after it) */
      if (E.synergyControl) E.synergyControl(host, state, { single: true, players: async () => {
        const B = ctx.bars ? await ctx.bars().catch(() => null) : null;
        return B && B.mine ? [{ id: B.mine.id, name: (state.c && state.c.name) || B.mine.name || '' }] : [];
      } });
      if (ctx.rapm) E.rapmControl(host, state, RAPM, {
        ids: async () => (ctx.gameIds ? await ctx.gameIds() : []),
        run: (ids, fn) => ctx.rapm(ids, fn),
        scope: () => (state.c && state.c.scope) || 'this league and season'
      });
    },
    async build(c, R) {
      const B = await ctx.bars();
      if (!B || !B.mine) return [block('<div class="rp-empty">No season line for this player in this scope yet.</div>')];
      const P = await pos();
      group = E.posGroup(P && P.pct, c.listedPos);
      const field = (B.field || []).map(r => Object.assign({}, r));
      let mine = field.find(r => r.id === B.mine.id) || Object.assign({}, B.mine);
      if (field.indexOf(mine) < 0) field.push(mine);
      const ids = ctx.gameIds ? await ctx.gameIds() : [];
      const rapmOk = RAPM.map && RAPM.key === E.rapmKey(ids) && E.rapmOn(RAPM, field);
      field.forEach(E.derive);
      const prof = await synOf(mine.id);
      if (prof && E.synergyOnRow) E.synergyOnRow(mine, prof);
      /* the turnover types, his own (from the club's logs the page has read) */
      try {
        const F = ctx.floor ? await ctx.floor() : null;
        if (F && F.logs) {
          const t = E.turnoverTypes(F.logs).get(mine.id);
          if (t && t.typed) { mine.badpass_pg = t.games ? Math.round(10 * t.bad / t.games) / 10 : null; mine.handle_pg = t.games ? Math.round(10 * t.handle / t.games) / 10 : null; }
        }
      } catch (_) { /* without them */ }
      const groups = E.groupsFor(R.state, 'main', group);
      const keys = groups.flatMap(g => g[1]);
      /* half-court AST%: every game of the competition replayed once (report.js hcAssists), for every player of the field */
      if ((keys.indexOf('hc_ast_pct') >= 0 || keys.indexOf('tr_ast_pct') >= 0) && ctx.fieldGames && E.hcAssists) {
        try {
          const G = await ctx.fieldGames();
          if (G && G.length) {
            const k = G.map(g => g.id).sort().join(',');
            if (HC.key !== k) { HC.key = k; HC.map = E.hcAssists(G); }
            field.forEach(r => { const t = HC.map.get(r.id); r.hc_ast_pct = E.hcAstOf(t); r.tr_ast_pct = E.trAstOf ? E.trAstOf(t) : null; });
          }
        } catch (e) { if (root.console) root.console.warn('[report half-court AST%]', e); }
      }
      /* every percentile among the players of his position (report.js posRanker), his own average theirs */
      const pools = E.posPools(field);
      const Rk = E.posRanker(field, keys, group, mine.id, pools);
      R.legend.push(...keys.filter(k => !(E.STATS[k] && E.STATS[k].optional) || (E.hasStat ? E.hasStat(k, mine) : E.isNum(mine[k]))));
      const tiles = [['GP', 'gp', 0], ['MIN / G', 'mpg', 1], ['PTS / G', 'ppg', 1], ['REB / G', 'rpg', 1], ['AST / G', 'apg', 1], ['BPM', 'bpm', 1, true]];
      const Rt = E.posRanker(field, tiles.map(t => t[1]).filter(k => k !== 'gp'), group, mine.id, pools);
      const tileHTML = '<div class="rp-tiles rp-tiles-b" style="--n:' + tiles.length + '">' + tiles.map(([l, k, dp, sg]) => {
        const v = mine[k], p = k === 'gp' ? null : Rt.pct(k, mine.id);
        return '<div class="rp-tile"' + (p == null ? '' : ' data-b="' + E.band(p) + '"') + '><b>' + (E.isNum(v) ? (sg && +v > 0 ? '+' : '') + (+v).toFixed(dp) : '—') + '</b><span>' + l + '</span>' +
          (p == null ? '' : '<span class="rp-rk" data-b="' + E.band(p) + '">' + E.ordinal(p) + '</span>') + '</div>'; }).join('') + '</div>';
      const needRapm = keys.some(k => E.STATS[k] && E.STATS[k].rapm) && !rapmOk;
      const out = [block(title('Season line', [c.scope, Rk.n ? 'ranked among ' + Rk.n + ' ' + Rk.who + (Rk.group ? ' (adjusted for position)' : '') : ''].filter(Boolean).join(' · ')) + tileHTML +
        (needRapm ? '<p class="rp-flagnote" style="margin-top:8px">ORAPM and DRAPM are not calculated for this league and season: they show blank (Calculate RAPM, above the pages).</p>' : ''))];
      out.push(block(E.colsHTML(E.groupsOn ? E.groupsOn(groups, mine) : groups, ([t, ks]) => '<div class="rp-g"><h4>' + esc(t) + '</h4>' + E.groupRowsHTML(ks, mine, Rk) + '</div>',
        ([, ks]) => E.groupWeight(ks)) +
        '<p class="rp-note">' + esc('Each row: the value, its percentile among the ' + Rk.n + ' ' + Rk.who + ' of ' + (c.scope || 'the competition') +
          ' (the bar), and their average' + (Rk.group ? ': every figure is adjusted for position, ranked against players of his own' : ': too few players of his position to rank him among them alone, so against everybody') +
          '. Template: ' + templateName(R.state, group) + '.') + '</p>'));
      return out;
    }
  };
  function templateName(state, g) {
    const t = state.conf.tpl.main || 'auto';
    if (state.temp && state.temp.main) return 'unsaved edit';
    if (t === 'auto') return 'by position (' + g + ')';
    if (/^pos:/.test(t)) return t.slice(4) + ' defaults';
    return t;
  }

  /* ---------------- SHOT CHART ---------------- */
  /* the zones court and every shot side by side, the shot zones in two columns under them; then the box score's
     half-court and transition cards over the season (his shots in each, situations.js on every game's log) */
  const shots = {
    key: 'shots', title: 'Shot chart', page: 'SHOT CHART', on: true,
    async build(c, R) {
      const SC = root.EpinoiaShotChart;
      const S = await ctx.shots();
      if (!SC || !S || !S.shots || !S.shots.length) return [block('<div class="rp-empty">No located shots for this player yet.</div>')];
      const colour = c.accent || '#08603f';
      const court = view => {
        const h = E.el('div');
        SC.renderZones({ host: h, shots: S.shots, colour: S.colour || colour, minAttempts: 3, games: S.games, gameList: S.gameList, zones: true, table: false,
                         view, controls: false });
        return h.innerHTML;
      };
      const made = S.shots.filter(x => x.made).length;
      const out = [];
      out.push(block(title('Where he shoots', S.shots.length + ' located shots · ' + made + ' made · ' + S.games + ' games') +
        '<div class="rp-two"><div><div class="rp-cap">Zones<span>tinted against each zone’s break-even</span></div>' + court('zones') + '</div>' +
        '<div><div class="rp-cap">Every shot<span>made ● missed ×</span></div>' + court('shots') + '</div></div>' +
        '<div class="rp-cap" style="margin-top:10px">Shot zones</div>' + E.zoneColumnsHTML(S.shots, S.games)));
      /* DIRECTION (Synergy): his drives left against right, and where each side's drives end - in the gap under the zones */
      try {
        const B = ctx.bars ? await ctx.bars().catch(() => null) : null;
        const prof = B && B.mine ? await synOf(B.mine.id) : null;
        const ch = prof && E.driveChartHTML ? E.driveChartHTML(prof) : '';
        if (ch) out.push(block(title('Direction', 'his drives, left and right') +
          '<div class="rp-two rp-dir"><div><div class="rp-cap">Left against right<span>PPP, share of his possessions, eFG%, TO%</span></div>' + ch + '</div>' +
          '<div><div class="rp-cap">Where the drives end<span>% of each side\u2019s shots</span></div>' + E.directionMixHTML(prof) + '</div></div>'));
      } catch (e) { if (root.console) root.console.warn('[report direction]', e); }
      try {
        const F = await ctx.floor();
        if (F && F.logs && F.sideOf && root.EpinoiaSituations) {
          const games = Object.keys(F.logs).filter(id => F.sideOf[id] != null).map(id => ({ events: F.logs[id], side: F.sideOf[id], pid: F.playerId }));
          const A = E.sitSeason(games);
          if (A.half.fga || A.transition.fga) {
            out.push(block(title('Half court and transition', 'his shots in each, the club’s last ' + games.length + ' games') +
              E.sitCardHTML(A.half, { key: 'half', colour, player: true, who: c.name })));
            out.push(block(E.sitCardHTML(A.transition, { key: 'transition', colour: '#b4572e', player: true, who: c.name })));
          }
        }
      } catch (e) { if (root.console) root.console.warn('[report situations]', e); }
      R.legendExtra.push(['ZONES', 'The court cut into twelve areas, each tinted against its own break-even (paint 58%, mid-range 40%, three 35%): orange above, blue below, grey within two points; hatched where there are too few attempts to rate.'],
        ['eFG%', 'Effective field-goal percentage: a made three counts as one and a half makes.'],
        ['HALF COURT / TRANSITION', 'The box score’s situations over the season: transition is a fast break, or within eight seconds of a defensive rebound or a steal; the half court is a chance that was none of second chance, transition, off a turnover or after a timeout.']);
      return out;
    }
  };

  /* ---------------- ON THE FLOOR WITH ---------------- */
  const floor = {
    key: 'floor', title: 'On the floor with', page: 'ON THE FLOOR WITH', on: true,
    async build(c, R) {
      const F = await ctx.floor();
      const WY = root.EpinoiaWowy, L = root.EpinoiaLineups, W = root.EpinoiaWith;
      if (!F || !F.stints || !F.stints.length || !WY) return [block('<div class="rp-empty">No lineup data for this player yet.</div>')];
      const out = [];
      const oo = E.el('div');
      WY.onOffTiles(oo, F.stints, F.playerId);
      out.push(block(title('The team with him on and off', 'net, offensive and defensive rating per 100 possessions') + oo.innerHTML));
      /* his own line over these games (the panel with no teammate picked) */
      if (W && W.split) {
        try {
          const sp = W.split(F.recs, F.stints, F.playerId, []);
          const l = sp && sp.all;
          if (l) {
            const f1 = v => (v == null ? '—' : (+v).toFixed(1));
            /* each against the players of his position (report.js posPools): their season per 36 minutes, ten or more a game;
               fewer turnovers are better, and how many shots and threes he takes is a style */
            const B = ctx.bars ? await ctx.bars().catch(() => null) : null;
            const P = await pos();
            const grp = E.posGroup(P && P.pct, c.listedPos);
            const fld = ((B && B.field) || []).filter(r => +r.mpg >= 10);
            const pools = E.posPools((B && B.field) || []);
            const myId = B && B.mine && B.mine.id;
            const same = fld.filter(r => r.id === myId || pools.get(r.id) === grp);
            const pool = same.length >= 12 ? same : fld;
            const p36 = (r, k) => (E.isNum(r[k]) && +r.mpg > 0 ? 36 * r[k] / r.mpg : null);
            const pctOf = (vals, v, low) => {
              const xs = vals.filter(E.isNum).map(Number);
              if (xs.length < 5 || !E.isNum(v)) return null;
              const below = xs.filter(x => x < +v).length, eq = xs.filter(x => x === +v).length;
              const p = 100 * (below + eq / 2) / xs.length;
              return Math.round(low ? 100 - p : p);
            };
            const cells = [['minutes', l.mins, null], ['pts / 36', l.pts36, r => p36(r, 'ppg')], ['shots / 36', l.fga36, r => p36(r, 'fga_pg'), 'style'],
              ['threes / 36', l.p3a36, r => p36(r, 'p3a_pg'), 'style'], ['reb / 36', l.reb36, r => p36(r, 'rpg')], ['ast / 36', l.ast36, r => p36(r, 'apg')],
              ['tov / 36', l.tov36, r => p36(r, 'topg'), 'low'], ['TS%', l.ts, r => r.ts]];
            const tile = ([k, v, of, how]) => {
              const p = of ? pctOf(pool.map(of), v, how === 'low') : null;
              const b = p == null ? 0 : E.band(p, how === 'style');
              return '<div class="rp-tile"' + (b ? ' data-b="' + b + '"' : '') + '><b>' + f1(v) + '</b><span>' + k + '</span>' +
                (p == null ? '' : '<span class="rp-rk" data-b="' + b + '">' + (how === 'style' ? E.ordinal(Math.max(1, Math.round((100 - p) / 100 * pool.length))) + ' most' : E.ordinal(p)) + '</span>') + '</div>';
            };
            out.push(block(title('His own numbers', 'per 36 minutes, over the games these lineups come from · coloured by his place among ' + pool.length + ' ' +
              (pool === same ? (E.POS_PLURAL[grp] || 'players') : 'players') + ' (10+ minutes a game)') +
              '<div class="rp-tiles rp-tiles-b" style="--n:' + cells.length + '">' + cells.map(tile).join('') + '</div>'));
          }
        } catch (_) { /* without it */ }
      }
      /* the pairings: the team with both of them on, against with him on and the teammate off */
      if (L && L.pairs) {
        const all = L.pairs(F.stints, F.playerId, 20).filter(p => p.swing != null);
        const meta = F.meta || {};
        const nm = id => (meta[id] && meta[id].name) || 'Player';
        const f1 = v => (v == null ? '—' : ((+v > 0 ? '+' : '') + (+v).toFixed(1)));
        const tbl = (rows, cap, cls) => '<div><div class="rp-cap ' + (cls || '') + '">' + cap + '</div><table class="rp-tbl"><thead><tr><th class="l">with</th><th>min</th><th>net both on</th><th>net him only</th><th>swing</th></tr></thead><tbody>' +
          (rows.length ? rows.map(p => '<tr><td class="l">' + esc(nm(p.id)) + '</td><td>' + Math.round(p.withMate.mins) + '</td>' +
            '<td data-b="' + E.bandVs(p.withMate.net, 0, 6) + '">' + f1(p.withMate.net) + '</td><td data-b="' + E.bandVs(p.withoutMate.net, 0, 6) + '">' + f1(p.withoutMate.net) +
            '</td><td class="rp-netc" data-b="' + E.bandVs(p.swing, 0, 6) + '">' + f1(p.swing) + '</td></tr>').join('') :
            '<tr><td class="l" colspan="5">Not enough shared minutes yet (20 or more).</td></tr>') + '</tbody></table></div>';
        const best = all.slice(0, 3), worst = all.slice(-3).reverse().filter(p => best.indexOf(p) < 0);
        out.push(block(title('Pairings', 'teammates he shared 20+ minutes with · green: the team outscores opponents, red: it is outscored') + '<div class="rp-two">' + tbl(best, 'Best three', 'good') + tbl(worst, 'Worst three', 'bad') + '</div>' +
          '<p class="rp-note">Swing: the team’s net rating with both of them on the floor minus with him on and that teammate off. Positive means the team is better when the two play together.</p>'));
        R.legendExtra.push(['SWING', 'The team’s net rating with both players on the floor minus with this player on and the teammate off, per 100 possessions.'],
          ['NET / ORTG / DRTG', 'Points scored minus allowed, points scored, and points allowed, each per 100 possessions.'],
          ['ON / OFF', 'The team’s numbers in the minutes he was on the floor against the minutes he was off it.']);
      }
      return out;
    }
  };

  /* ---------------- LAST 7 DAYS (the weekly report) ---------------- */
  const week = {
    key: 'week', title: 'Last 7 days', page: 'LAST 7 DAYS', on: false,
    async build() {
      const W = root.EpinoiaWeekly;
      if (!W || !ctx.week) return [];
      const rep = await ctx.week();
      return [block(W.render(rep, { window: 'the last seven days', saveable: false }))];
    }
  };

  const legend = { key: 'legend', title: 'Legend', on: true };
  return [cover, main, shots, floor, week, legend];
}

return { modules };
}));
