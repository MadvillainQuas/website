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

/* CONNECTIONS' PAIRING (the CONNECTIONS section, below): every assist of the player's (ids: his profiles) paired with its basket
   by the game page's rule (game/connections.js), the basket kept: where it was taken (situations.js describe's locs, x/y 0..1),
   its zone (rim / mid / three) and its type; and every basket of his that another's assist led to. -> { out, into, games } */
function passLinks(games, ids) {
  const X = root.EpinoiaSituations;
  const me = new Set((ids || []).filter(Boolean).map(String));
  const out = [], into = [];
  let n = 0;
  (games || []).forEach(g => {
    const evs = g.events || [];
    if (!evs.some(e => e && e.pid != null && me.has(String(e.pid)))) return;
    n++;
    const order = X && X.inGameOrder ? X.inGameOrder(evs) : evs;
    const Dsc = X && X.describe ? X.describe(evs) : { locs: {}, stypes: {}, zoneOf: () => null };
    let last = null;
    order.forEach(ev => {
      if ((ev.t === 'p2_made' || ev.t === 'p3_made') && ev.pid) last = ev;
      else if (ev.t === 'ast') {
        const shot = last && last.team === ev.team ? last : null;
        if (ev.pid && shot && String(shot.pid) !== String(ev.pid)) {
          const id = shot.id != null ? shot.id : shot.seq, l = Dsc.locs[id], three = shot.t === 'p3_made';
          const link = { game: g.id, from: String(ev.pid), to: String(shot.pid), pts: three ? 3 : 2, three,
            zone: three ? 'three' : (Dsc.zoneOf(shot) || 'mid'), type: String(Dsc.stypes[id] || '').toLowerCase() || null,
            x: l ? +l.x : null, y: l ? +l.y : null };
          if (me.has(link.from)) out.push(link); else if (me.has(link.to)) into.push(link);
        }
        last = null;
      }
    });
  });
  return { out, into, games: n };
}
function byMate(links, key) {
  const m = new Map();
  links.forEach(l => {
    const k = l[key];
    const a = m.get(k) || { id: k, n: 0, pts: 0, threes: 0, rim: 0, mid: 0, types: {} };
    a.n++; a.pts += l.pts;
    if (l.three) a.threes++; else if (l.zone === 'rim') a.rim++; else a.mid++;
    if (l.type) a.types[l.type] = (a.types[l.type] || 0) + 1;
    m.set(k, a);
  });
  return [...m.values()].sort((a, b) => b.n - a.n || b.pts - a.pts);
}

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
        main = NAMES[k] + ' (' + Math.round(P.pct[k]) + '% of their minutes)';
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
        scope: () => (state.c && (state.c.field || state.c.scope)) || 'this league and season'
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
      /* the field to rank in: this season's players and the league's other seasons' (report.js loadPrior), each season one more entry */
      const poolField = field.concat(E.priorRows(B.prior, P => P.players));
      if (poolField.length > field.length) R.pooled = 'Every figure is ranked against all ' + ((B.prior || []).length + 1) + ' seasons of the league with data (each player’s season is one entry), among players of their own position, not only the season shown. A stat an earlier season did not record is ranked within the season shown.';
      const pools = E.posPools(poolField);
      const Rk = E.posRanker(poolField, keys, group, mine.id, pools);
      /* WHAT THE INSIGHTS READ (INSIGHTS, scoutinsights.js develop): his line, and his place among his position on every
         measure they may speak of, the template's or not */
      const IK = ['usg', 'ev_half_usg', 'ts', 'efg', 'ftr', 'ft_pct', 'au', 'hc_ast_pct', 'ast_pct', 'tov_pct', 'rim_a100', 'rim_pct', 'ev_half_rim_pct',
        'mid_a100', 'mid_pct', 'p3_a100', 'p3_pct', 'ev_transition_rim_a100', 'ev_transition_rim_pct', 'oreb_pct', 'dreb_pct', 'stl_pct', 'blk_pct',
        'pf_pg', 'dbpm', 'obpm', 'bpm'];
      const RkI = E.posRanker(poolField, IK, group, mine.id, pools);
      R.facts = R.facts || {};
      R.facts.main = { mine, group, who: RkI.who, n: RkI.nNow || RkI.n, pct: k => RkI.pct(k, mine.id), avg: k => RkI.avg(k) };
      R.legend.push(...keys.filter(k => !(E.STATS[k] && E.STATS[k].optional) || (E.hasStat ? E.hasStat(k, mine) : E.isNum(mine[k]))));
      const tiles = [['GP', 'gp', 0], ['MIN / G', 'mpg', 1], ['PTS / G', 'ppg', 1], ['REB / G', 'rpg', 1], ['AST / G', 'apg', 1], ['BPM', 'bpm', 1, true]];
      R.legend.push(...tiles.map(t => t[1]));          // the headline tiles have legend entries too, so their names link there
      const Rt = E.posRanker(poolField, tiles.map(t => t[1]).filter(k => k !== 'gp'), group, mine.id, pools);
      const tileHTML = '<div class="rp-tiles rp-tiles-b" style="--n:' + tiles.length + '">' + tiles.map(([l, k, dp, sg]) => {
        const v = mine[k], p = k === 'gp' ? null : Rt.pct(k, mine.id);
        return '<div class="rp-tile"' + (p == null ? '' : ' data-b="' + E.band(p) + '"') + '><b>' + (E.isNum(v) ? (sg && +v > 0 ? '+' : '') + (+v).toFixed(dp) : '—') + '</b><span data-lg="' + k + '">' + l + '</span>' +
          (p == null ? '' : '<span class="rp-rk" data-b="' + E.band(p) + '">' + E.ordinal(p) + '</span>') + '</div>'; }).join('') + '</div>';
      const needRapm = keys.some(k => E.STATS[k] && E.STATS[k].rapm) && !rapmOk;
      const out = [block(title('Season line', [c.scope, Rk.n ? 'ranked among ' + (Rk.nNow || Rk.n) + ' ' + Rk.who + (Rk.nNow && Rk.nNow < Rk.n ? ' this season' : '') + (Rk.group ? ' (adjusted for position)' : '') : ''].filter(Boolean).join(' · ')) + tileHTML +
        (needRapm ? '<p class="rp-flagnote" style="margin-top:8px">ORAPM and DRAPM are not calculated for this league and season: they show blank (Calculate RAPM, above the pages).</p>' : ''))];
      /* THE GROUPS, A BLOCK OF PARTS (report.js splitBlock): as many as fit under the season line, in two columns, and the
         rest on the next page - they were one block too tall to go under it, which left this page a strip of tiles and
         four-fifths blank (Louie, 2026-10-16) */
      const gl = E.groupsOn ? E.groupsOn(groups, mine) : groups;
      const gHTML = ([t, ks]) => '<div class="rp-g"><h4>' + esc(t) + '</h4>' + E.groupRowsHTML(ks, mine, Rk) + '</div>';
      const gCols = ps => block(E.colsHTML(ps, gHTML, ([, ks]) => E.groupWeight(ks)));
      out.push(E.splitBlock ? E.splitBlock(gl, gCols) : gCols(gl));
      out.push(block(
        '<p class="rp-note">' + esc('Each row: the value, its percentile among the ' + (Rk.nNow || Rk.n) + ' ' + Rk.who + ' of ' + (c.field || c.scope || 'the competition') + (Rk.nNow && Rk.nNow < Rk.n ? ' (with earlier seasons’, ' + Rk.n + ' in all, deepening the field)' : '') +
          ' (the bar), and their average' + (Rk.group ? ': every figure is adjusted for position, ranked against players of their own' : ': too few players of their position to rank that player among them alone, so against everybody') +
          '. Template: ' + templateName(R.state, group) + '.') + '</p>' + E.keyHTML('Reading the player’s numbers', [
          ['THE BAR · THE ORDINAL', 'Where they sit among players of their own position in the field named above: 80th means better than eight in ten of them. Green is the top quarter, red the bottom; blue-to-purple bars are styles, deeper = more of it.'],
          ['ASSIST TO USAGE RATIO', 'Their assist rate against their usage: how much they create for others per possession they use themselves.'],
          ['VOL / 100', 'Shots from that zone per 100 of the team’s possessions while they are on the floor: where they shoot, not how well.'],
          ['ASSISTED%', 'The share of their baskets in a zone that came off a pass. Coloured the other way round: a low share (green) means they create their own shots there.'],
          ['HALF-COURT FIGURES', 'Leave out fast breaks, second chances and shots off turnovers: how they do against a set defence.'],
          ['± (ON/OFF)', 'The team’s figure with them on the floor minus with them off it. Noisy for a player with few minutes.']], 'one')));
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
    key: 'shots', title: 'Shot chart', page: 'SHOT CHART', on: true, pack: 'flow',
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
      /* the courts, and the zone table under them, two blocks: the courts can begin under the section before when its page has
         room, the table following (report.js layout, pack 'flow') */
      out.push(block(title('Where they shoot', S.shots.length + ' located shots · ' + made + ' made · ' + S.games + ' games') +
        '<div class="rp-two"><div><div class="rp-cap">Zones<span>tinted against each zone’s break-even</span></div>' + court('zones') + '</div>' +
        '<div><div class="rp-cap">Every shot<span>made ● missed ×</span></div>' + court('shots') + '</div></div>'));
      out.push(block('<div class="rp-cap">Shot zones</div>' + E.zoneColumnsHTML(S.shots, S.games)));
      try {
        const F = await ctx.floor();
        if (F && F.logs && F.sideOf && root.EpinoiaSituations) {
          const games = Object.keys(F.logs).filter(id => F.sideOf[id] != null).map(id => ({ events: F.logs[id], side: F.sideOf[id], pid: F.playerId }));
          const A = E.sitSeason(games);
          R.facts = R.facts || {};
          R.facts.sit = { half: A.half, transition: A.transition };
          if (A.half.fga || A.transition.fga) {
            out.push(block(title('Half court and transition', 'their shots in each, the club’s last ' + games.length + ' games') +
              E.sitCardHTML(A.half, { key: 'half', colour, player: true, who: c.name })));
            out.push(block(E.sitCardHTML(A.transition, { key: 'transition', colour: '#b4572e', player: true, who: c.name })));
          }
        }
      } catch (e) { if (root.console) root.console.warn('[report situations]', e); }
      /* DIRECTION (Synergy): his drives left against right, and where each side's drives end - after the half court and
         transition cards (2026-10-16), whose half-page cards it left a half-empty page before */
      try {
        const B = ctx.bars ? await ctx.bars().catch(() => null) : null;
        const prof = B && B.mine ? await synOf(B.mine.id) : null;
        const ch = prof && E.driveChartHTML ? E.driveChartHTML(prof) : '';
        if (ch) out.push(block(title('Direction', 'their drives, left and right') +
          '<div class="rp-two rp-dir"><div><div class="rp-cap">Left against right<span>PPP, share of their possessions, eFG%, TO%</span></div>' + ch + '</div>' +
          '<div><div class="rp-cap">Where the drives end<span>% of each side\u2019s shots</span></div>' + E.directionMixHTML(prof) + '</div></div>'));
      } catch (e) { if (root.console) root.console.warn('[report direction]', e); }
      R.legendExtra.push(['ZONES', 'The court cut into twelve areas, each tinted against its own break-even (paint 58%, mid-range 40%, three 35%): orange above, blue below, grey within two points; hatched where there are too few attempts to rate.'],
        ['eFG%', 'Effective field-goal percentage: a made three counts as one and a half makes.'],
        ['HALF COURT / TRANSITION', 'The box score’s situations over the season: transition is a fast break, or within eight seconds of a defensive rebound or a steal; the half court is a chance that was none of second chance, transition, off a turnover or after a timeout.']);
      return out;
    }
  };

  /* ---------------- LEFT V RIGHT ---------------- */
  /* A PAGE OF ITS OWN (lvr.js; Louie, 2026-10-16): his eFG% from each side of the floor and every shot distance's FG% on each
     side, all his shots and then only his unassisted ones, and where his unassisted shots come from on the court - always over
     every season and competition he has played (lvr.js career, the profile card's own read), whatever the report's scope */
  const lvr = {
    key: 'lvr', title: 'Left v right', page: 'LEFT V RIGHT', on: true, pack: 'flow',
    async build(c, R) {
      const LV = root.EpinoiaLvR, SC = root.EpinoiaShotChart;
      const C = LV && ctx.lvr ? await ctx.lvr().catch(() => null) : null;
      if (!LV || !C || !C.shots || !C.shots.length) return [block('<div class="rp-empty">No located shots for this player yet.</div>')];
      const all = LV.split(C.shots), un = LV.split(C.shots, { unassisted: true });
      R.facts = R.facts || {};
      R.facts.lvr = { all, un };
      const out = [];
      out.push(block(title('Left v right', 'his shooting from each side of the floor, facing the basket · ' + LV.basis(C) + ' · ' + all.n + ' located shots') +
        '<div class="rp-two rp-lvr"><div><div class="rp-cap">All shots<span>eFG% by side, FG% by distance</span></div>' + LV.cardHTML(all, { compact: true }) + '</div>' +
        '<div><div class="rp-cap">Unassisted<span>his own shots: see the legend</span></div>' +
        LV.cardHTML(un, { compact: true, empty: C.gamesWithAssists ? 'No unassisted shots.' : 'His games do not log assists.' }) + '</div></div>'));
      const ush = LV.unassistedShots(C.shots);
      if (SC && ush.length) {
        const colour = c.accent || '#08603f';
        const court = view => {
          const h = E.el('div');
          SC.renderZones({ host: h, shots: ush, colour, minAttempts: 3, games: C.games, zones: true, table: false, view, controls: false });
          return h.innerHTML;
        };
        const made = ush.filter(x => x.made).length;
        out.push(block(title('Unassisted shot chart', ush.length + ' shots of his own · ' + made + ' made · every season and competition') +
          '<div class="rp-two"><div><div class="rp-cap">Zones<span>tinted against each zone’s break-even</span></div>' + court('zones') + '</div>' +
          '<div><div class="rp-cap">Every unassisted shot<span>made ● missed ×</span></div>' + court('shots') + '</div></div>'));
      }
      R.legendExtra.push(['LEFT V RIGHT', 'His shots from the left and the right side of the floor, facing the basket, over every season and competition he has played: each side’s eFG% at the head; a row per distance (at the rim to 1.25 m, short twos to 3 m, mid-range to 5 m, long twos, corner threes, threes above the break) with the FG% and makes-attempts on each side, the bar as long as the share of that side’s shots from there and filled to the FG%.'],
        ['UNASSISTED', 'His shots without a pass behind them, from the games that log assists. A make is his own when no assist was given for it. A miss is never marked, so it is read by its shot type: a pull-up, step-back, fadeaway, floater, hook, putback or tip-in is his own, an alley-oop was a pass, and any other miss counts as his own in the share his makes from that distance were. The shot chart draws every shot at least half his own.']);
      return out;
    }
  };

  /* ---------------- ON THE FLOOR WITH ---------------- */
  const floor = {
    key: 'floor', title: 'On the floor with', page: 'ON THE FLOOR WITH', on: true, pack: 'flow',
    async build(c, R) {
      const F = await ctx.floor();
      const WY = root.EpinoiaWowy, L = root.EpinoiaLineups, W = root.EpinoiaWith;
      if (!F || !F.stints || !F.stints.length || !WY) return [block('<div class="rp-empty">No lineup data for this player yet.</div>')];
      const out = [];
      const oo = E.el('div');
      WY.onOffTiles(oo, F.stints, F.playerId);
      /* TWO BLOCKS (2026-10-16): the three tiles and the minutes split, then the table of every figure on and off - one block,
         it was a page of its own and could never begin under the section before, which left that page half empty */
      const card = oo.querySelector(':scope > .oo');
      const ooHead = title('The team with them on and off', 'net, offensive and defensive rating per 100 possessions');
      if (card && card.querySelector(':scope > .oo-top') && card.querySelector(':scope > .dl')) {
        const a = E.el('div', card.className);
        [...card.children].forEach(ch => { if (ch.classList.contains('oo-top') || ch.classList.contains('oo-split')) a.appendChild(ch); });
        const grid = card.querySelector(':scope > .dl');
        const tail = [...card.children].filter(ch => ch !== grid).map(x => x.outerHTML).join('');      // the key and the note
        const rest = [...oo.children].filter(x => x !== card).map(x => x.outerHTML).join('');
        out.push(block(ooHead + a.outerHTML));
        /* THE TABLE, A BLOCK OF PARTS: a group of rows each (the ratings, offence, defence, style), the column heads over every
           run of them, the key under the last - so the groups that fit go under the tiles and the rest overleaf */
        const heads = [...grid.children].filter(x => x.classList.contains('dl-h')).map(x => x.outerHTML).join('');
        const groups = [];
        let cur = null;
        [...grid.children].forEach(x => {
          if (x.classList.contains('dl-h')) return;
          if (x.classList.contains('dl-g')) { cur = [x.outerHTML]; groups.push(cur); } else if (cur) cur.push(x.outerHTML);
        });
        const parts = groups.map(gp => gp.join(''));
        const last = parts[parts.length - 1];
        const tbl = ps => block('<div class="' + card.className + ' oo-cont"><div class="' + grid.className + '">' + heads + ps.join('') + '</div>' +
          (ps[ps.length - 1] === last ? tail + rest : '') + '</div>');
        out.push(parts.length > 1 && E.splitBlock ? E.splitBlock(parts, tbl) : tbl(parts));
      } else out.push(block(ooHead + oo.innerHTML));
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
            out.push(block(title('Their own numbers', 'per 36 minutes, over the games these lineups come from · coloured by their place among ' + pool.length + ' ' +
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
        const tbl = (rows, cap, cls) => '<div><div class="rp-cap ' + (cls || '') + '">' + cap + '</div><table class="rp-tbl"><thead><tr><th class="l">with</th><th>min</th><th>net both on</th><th>net them only</th><th>swing</th></tr></thead><tbody>' +
          (rows.length ? rows.map(p => '<tr><td class="l">' + esc(nm(p.id)) + '</td><td>' + Math.round(p.withMate.mins) + '</td>' +
            '<td data-b="' + E.bandVs(p.withMate.net, 0, 6) + '">' + f1(p.withMate.net) + '</td><td data-b="' + E.bandVs(p.withoutMate.net, 0, 6) + '">' + f1(p.withoutMate.net) +
            '</td><td class="rp-netc" data-b="' + E.bandVs(p.swing, 0, 6) + '">' + f1(p.swing) + '</td></tr>').join('') :
            '<tr><td class="l" colspan="5">Not enough shared minutes yet (20 or more).</td></tr>') + '</tbody></table></div>';
        const best = all.slice(0, 3), worst = all.slice(-3).reverse().filter(p => best.indexOf(p) < 0);
        out.push(block(title('Pairings', 'teammates they shared 20+ minutes with · green: the team outscores opponents, red: it is outscored') + '<div class="rp-two">' + tbl(best, 'Best three', 'good') + tbl(worst, 'Worst three', 'bad') + '</div>' +
          '<p class="rp-note">Swing: the team’s net rating with both of them on the floor minus with them on and that teammate off. Positive means the team is better when the two play together.</p>'));
        R.legendExtra.push(['SWING', 'The team’s net rating with both players on the floor minus with this player on and the teammate off, per 100 possessions.'],
          ['NET / ORTG / DRTG', 'Points scored minus allowed, points scored, and points allowed, each per 100 possessions.'],
          ['ON / OFF', 'The team’s numbers in the minutes they were on the floor against the minutes they were off it.']);
      }
      return out;
    }
  };

  /* ---------------- CONNECTIONS ---------------- */
  /* WHO HE SETS UP, AND THE SHOTS HIS PASSES BECOME (Louie, 2026-10-16: "a connections section that shows the players that
     player is most assisting and the shots that come from that"): every assist of his paired with the basket it led to by
     the game page's own rule (game/connections.js: the last made field goal of the same side, each basket once), kept with
     the shot, so where it was taken and what kind of shot it was are known (situations.js describe); and the other way, who
     sets him up. Over the games of the report's competition (ctx.fieldGames), else his club's last 40 (ctx.floor). */
  const PAL = ['#0b7a4b', '#e0702b', '#3d6fd8', '#a2449b', '#c79a14'];
  const conn = {
    key: 'conn', title: 'Connections', page: 'CONNECTIONS', on: true, pack: 'flow',
    async build(c, R) {
      const B = ctx.bars ? await ctx.bars().catch(() => null) : null;
      const ids = (ctx.pids ? await ctx.pids().catch(() => []) : []).concat(B && B.mine ? [B.mine.id] : []);
      let games = ctx.fieldGames ? await ctx.fieldGames().catch(() => null) : null;
      let src = 'every game of ' + (c.scope || 'the competition');
      if (!games || !games.length) {
        const F = ctx.floor ? await ctx.floor().catch(() => null) : null;
        games = F && F.logs ? Object.keys(F.logs).map(id => ({ id, events: F.logs[id] })) : [];
        src = 'the club’s last ' + games.length + ' games';
      }
      const L = passLinks(games, ids);
      const head = title('Connections', 'who they set up, and the shots their passes become · ' + src);
      if (!L.out.length && !L.into.length) return [block(head + '<div class="rp-empty">No assist of theirs, or to them, paired with its basket yet (it needs a play-by-play that logs assists).</div>')];
      const mates = byMate(L.out, 'to'), feeders = byMate(L.into, 'from');
      const meta = ctx.meta ? await ctx.meta([...new Set(mates.concat(feeders).map(m => m.id))]).catch(() => ({})) : {};
      const nm = id => (meta[id] && meta[id].name) || 'Teammate';
      const top = mates.slice(0, PAL.length), colourOf = new Map(top.map((m, i) => [m.id, PAL[i]]));
      /* the court: where each of his assists was finished, a colour for each of the teammates he finds most */
      const Box = root.EpinoiaBox;
      let court = '';
      const located = L.out.filter(l => l.x != null && l.y != null);
      if (Box && Box.courtSVG && located.length) {
        const C = Box.COURT;
        const dots = located.slice().sort((a, b) => (colourOf.has(a.to) ? 1 : 0) - (colourOf.has(b.to) ? 1 : 0)).map(l => {
          const p = Box.snapToValue ? Box.snapToValue(l.x, l.y, l.three) : l;
          return '<circle cx="' + (p.x * C.W).toFixed(0) + '" cy="' + (p.y * C.H).toFixed(0) + '" r="32" fill="' + (colourOf.get(l.to) || '#a7b2ac') + '" stroke="#ffffff" stroke-width="7"/>';
        }).join('');
        court = '<div class="rp-sit-c"><div class="rp-court">' + Box.courtSVG(null, { plain: true }).replace('</svg>', dots + '</svg>') + '</div></div>' +
          '<div class="rp-cn-key">' + top.map(m => '<span><i style="background:' + colourOf.get(m.id) + '"></i>' + esc(nm(m.id)) + '</span>').join('') +
          (mates.length > top.length ? '<span><i style="background:#a7b2ac"></i>others</span>' : '') + '</div>';
      } else court = '<div class="rp-empty">No locations recorded for these baskets.</div>';
      const pct = (a, b) => (b ? Math.round(100 * a / b) + '%' : '—');
      const kinds = m => Object.entries(m.types).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t, n]) => n + ' ' + t + (n > 1 && !/s$/.test(t) ? 's' : '')).join(', ');
      const rowOf = (m, sw) => '<tr><td class="l">' + (sw ? '<i class="rp-cn-sw" style="background:' + (colourOf.get(m.id) || '#a7b2ac') + '"></i>' : '') + esc(nm(m.id)) + '</td><td>' + m.n + '</td><td>' + m.pts + '</td>' +
        '<td>' + m.threes + '</td><td>' + m.rim + '</td><td>' + m.mid + '</td>' + (sw ? '<td class="l rp-cn-k">' + esc(kinds(m) || '—') + '</td>' : '') + '</tr>';
      const out = L.out.length;
      const tblOut = '<div class="rp-cap">They set up<span>' + out + ' assisted baskets · ' + pct(L.out.filter(l => l.three).length, out) + ' threes · ' + pct(L.out.filter(l => !l.three && l.zone === 'rim').length, out) + ' at the rim</span></div>' +
        '<table class="rp-tbl rp-cn"><thead><tr><th class="l">teammate</th><th>ast</th><th>pts</th><th>3pt</th><th>rim</th><th>mid</th><th class="l">most often</th></tr></thead><tbody>' +
        (mates.length ? mates.slice(0, 7).map(m => rowOf(m, true)).join('') : '<tr><td class="l" colspan="7">No assists of theirs paired yet.</td></tr>') + '</tbody></table>';
      const tblIn = feeders.length ? '<div class="rp-cap" style="margin-top:10px">Who sets them up<span>' + L.into.length + ' of their baskets assisted</span></div>' +
        '<table class="rp-tbl rp-cn"><thead><tr><th class="l">passer</th><th>ast</th><th>pts</th><th>3pt</th><th>rim</th><th>mid</th></tr></thead><tbody>' +
        feeders.slice(0, 4).map(m => rowOf(m, false)).join('') + '</tbody></table>' : '';
      R.facts = R.facts || {};
      R.facts.conn = { total: out, threes: L.out.filter(l => l.three).length, rim: L.out.filter(l => !l.three && l.zone === 'rim').length,
        mates: mates.map(m => Object.assign({ name: nm(m.id) }, m)), into: L.into.length, feeders: feeders.map(m => Object.assign({ name: nm(m.id) }, m)), games: L.games };
      R.legendExtra.push(['CONNECTIONS', 'Every assist paired with the basket it led to, as the game page’s Connections tab pairs them (the last made field goal of the passer’s side, each basket once): who they set up and who sets them up, how many points those baskets were worth, and where they were scored, at the rim, from mid-range or from three. A pass that led to free throws is not counted.']);
      return [block(head + '<div class="rp-two rp-cn-g"><div>' + court + '</div><div>' + tblOut + tblIn + '</div></div>')];
    }
  };
  /* ---------------- GAMES PLAYED DURING THE WEEK ---------------- */
  /* HIS WEEK, GAME BY GAME (Louie, 2026-10-16: "shows the shot charts for those games, and their full stats row from those games
     stacked on top of each other (so the match report pdfs full table segments - but only for that player and with their rows
     stacked so they can be on the same page - organised by the games that were played)"): a court of his shots for each game,
     then the match report's three FULL STATS tables (gamefull.js), a row a game, each figure read against its own game. The
     week is the weekly email's (?rpweek=), else the week of his latest game (p/player.js loadWeekGames). */
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayOf = ymd => { const d = new Date(ymd + 'T12:00:00Z'); return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]; };
  const spanOf = (a, b) => { const x = new Date(a + 'T12:00:00Z'), y = new Date(b + 'T12:00:00Z');
    if (a === b) return DAYS[x.getUTCDay()] + ' ' + x.getUTCDate() + ' ' + MONTHS[x.getUTCMonth()] + ' ' + x.getUTCFullYear();
    return DAYS[x.getUTCDay()] + ' ' + x.getUTCDate() + (x.getUTCMonth() === y.getUTCMonth() ? '' : ' ' + MONTHS[x.getUTCMonth()]) + ' – ' + DAYS[y.getUTCDay()] + ' ' + y.getUTCDate() + ' ' + MONTHS[y.getUTCMonth()] + ' ' + y.getUTCFullYear(); };
  const wkg = {
    key: 'wkg', title: 'Games played during the week', page: 'GAMES PLAYED DURING THE WEEK', on: true, pack: 'flow',
    async build(c, R) {
      const W = ctx.weekGames ? await ctx.weekGames() : null;
      const GF = root.EpinoiaGameFull, Box = root.EpinoiaBox;
      if (!W || !W.games || !W.games.length || !GF || !Box) return [];
      const gl = W.games;
      /* THE GAMES CHOSEN (?rpgames=: a player's "send now" from the reports manager, 0273): the same section, named for them */
      const picked = !!W.picked;
      wkg.page = picked ? 'SELECTED GAMES' : 'GAMES PLAYED DURING THE WEEK';
      const where = g => (g.home ? 'vs ' : 'at ') + g.opp;
      const score = g => g.res + ' ' + g.us + '–' + g.them;
      const C = Box.COURT;
      const card = g => {
        const s = g.raw || {}, a = g.row || {};
        const fgm = (+s.p2m || 0) + (+s.p3m || 0), fga = (+s.p2a || 0) + (+s.p3a || 0);
        const line = [(+s.pts || 0) + ' PTS', fgm + '/' + fga + ' FG', (+s.p3m || 0) + '/' + (+s.p3a || 0) + ' 3PT', (+s.ftm || 0) + '/' + (+s.fta || 0) + ' FT',
          ((+s.or || 0) + (+s.dr || 0)) + ' REB', (+s.ast || 0) + ' AST', (+s.to || 0) + ' TO', (a.minTxt || '') + ' MIN'];
        const loc = (g.shots || []).filter(x => x.x != null && x.y != null);
        const dots = loc.slice().sort((x, y) => x.made - y.made).map(x => {
          const cx = (x.x * C.W).toFixed(0), cy = (x.y * C.H).toFixed(0);
          return x.made ? '<circle class="rp-dot m" cx="' + cx + '" cy="' + cy + '" r="32"/>' : '<circle class="rp-dot x" cx="' + cx + '" cy="' + cy + '" r="26"/>';
        }).join('');
        const court = loc.length ? '<div class="rp-sit-c"><div class="rp-court">' + Box.courtSVG(null, { plain: true }).replace('</svg>', dots + '</svg>') + '</div></div>'
          : '<div class="rp-empty rp-wk-none">No located shots in this game.</div>';
        const hd = '<div class="rp-wk-h"><b>' + esc(where(g)) + '</b><span class="rp-wk-r ' + (g.res === 'W' ? 'w' : g.res === 'L' ? 'l' : '') + '">' + esc(score(g)) + '</span>' +
          '<small>' + esc(dayOf(g.day)) + (loc.length ? ' · ' + loc.filter(x => x.made).length + '/' + loc.length + ' located' : '') + '</small></div>';
        /* A WEEK OF ONE GAME: the court and the game side by side, his line in tiles and his shots by zone, where a card half the
           page wide left the other half blank */
        if (wide) {
          const SC = root.EpinoiaShotChart;
          const kinds = { paint: [0, 0], mid: [0, 0], three: [0, 0] };
          if (SC && SC.zones && loc.length) Object.values(SC.zones(loc)).forEach(z => { const k = kinds[z.kind]; if (k) { k[0] += z.made || 0; k[1] += z.att || 0; } });
          const tiles = [['PTS', +s.pts || 0], ['FG', fgm + '/' + fga], ['3PT', (+s.p3m || 0) + '/' + (+s.p3a || 0)], ['FT', (+s.ftm || 0) + '/' + (+s.fta || 0)],
            ['REB', (+s.or || 0) + (+s.dr || 0)], ['AST', +s.ast || 0], ['TO', +s.to || 0], ['MIN', a.minTxt || '—']];
          return '<div class="rp-wk-c wide"><div class="rp-wk-cl">' + court + '</div><div class="rp-wk-cr">' + hd +
            '<div class="rp-wk-t">' + tiles.map(([l, x]) => '<div><b>' + esc(x) + '</b><span>' + l + '</span></div>').join('') + '</div>' +
            (loc.length ? '<div class="rp-cap" style="margin-top:12px">By zone<span>made / attempted, located shots</span></div><div class="rp-wk-z">' +
              [['In the paint', 'paint'], ['Mid-range', 'mid'], ['Three', 'three']].map(([l, k]) => '<div><span>' + l + '</span><b>' + kinds[k][0] + '/' + kinds[k][1] + '</b><i style="width:' +
                (kinds[k][1] ? 100 * kinds[k][0] / kinds[k][1] : 0).toFixed(0) + '%"></i></div>').join('') + '</div>' : '') + '</div></div>';
        }
        return '<div class="rp-wk-c">' + hd + court + '<div class="rp-wk-l">' + line.map(t => '<span>' + esc(t) + '</span>').join('') + '</div></div>';
      };
      const wide = gl.length === 1;
      const n = gl.length;
      const out = [];
      /* the courts, three to a row: a block of parts, so a week of many games carries its last row on */
      const rows = []; for (let i = 0; i < gl.length; i += 3) rows.push(gl.slice(i, i + 3));
      out.push(E.splitBlock(rows, (ps, cont) => block((cont ? '' : title(picked ? 'Selected games' : 'Games played during the week', spanOf(W.monday, W.sunday) + ' · ' + n + (n === 1 ? ' game' : ' games') + ' · their shots in each, then their line as the match report prints it, each figure against its own game')) +
        ps.map(r => '<div class="rp-wk" style="--n:' + (wide ? 1 : Math.min(3, n)) + '">' + r.map(card).join('') + '</div>').join(''))));
      /* the match report's three FULL STATS tables, a row a game */
      const nameCell = r => { const g = r.__g; return '<span class="fs-who"><b>' + esc(where(g)) + '</b><em>' + esc(dayOf(g.day) + ' · ' + score(g)) + '</em></span>'; };
      GF.PARTS.forEach(([what, keep, note]) => {
        out.push(block('<div class="rp-cap">' + esc(what) + '<span>' + esc(note) + '</span></div>' +
          GF.table({ groups: Box.ADV_GROUPS, keep, rows: gl.map(g => Object.assign({ __g: g }, g.row)), ctxOf: r => r.__g.cx, nameCell, head: 'Game', cls: 'rp-wkfs' })));
      });
      R.facts = R.facts || {};
      R.facts.week = { monday: W.monday, sunday: W.sunday, games: gl, picked };
      if (picked) R.legendExtra.push(['SELECTED GAMES', 'The games chosen for this report: a court of their shots in each (made ●, missed ×), then the match report’s full stats, a row a game. Each figure is shaded by its percentile among players’ games in the league, a bar shows its size beside that game’s other players, and the on-court columns are the difference from that game’s average.']);
      else R.legendExtra.push(['GAMES PLAYED DURING THE WEEK', 'Their games of the week, Monday to Sunday in the league’s time zone: a court of their shots in each (made ●, missed ×), then the match report’s full stats, a row a game. Each figure is shaded by its percentile among players’ games in the league, a bar shows its size beside that game’s other players, and the on-court columns are the difference from that game’s average.']);
      return out;
    }
  };

  /* ---------------- INSIGHTS ---------------- */
  /* WHAT TO KEEP DOING AND WHAT TO WORK ON, FOR HIS POSITION (Louie, 2026-10-16: "a section at the bottom before the legend
     orientated to their position, with actionable insights using basketball language through reading the whole pdf"):
     scoutinsights.js develop, from what every section of this report found (R.facts: the season line and its ranks, the
     half court and transition, left v right, on the floor, connections, the week) */
  const ins = {
    key: 'ins', title: 'Insights', page: 'INSIGHTS', on: true, pack: 'flow',
    async build(c, R) {
      const SI = root.EpinoiaScoutInsights;
      const F = R.facts || {};
      if (!SI || !SI.develop || !F.main) return [];
      const D = SI.develop(Object.assign({ name: c.name }, F));
      if (!D || (!D.keep.length && !D.work.length && !D.week.length)) return [];
      /* the finding and its evidence; NOT the highlighted coaching line under it (x.act, "Arrive under control: a jump stop...") -
         Louie, 2026-10-16: the report says what the numbers show, the playing advice is the coach's */
      const li = x => '<li><b>' + esc(x.head) + '</b> ' + esc(x.text) + '</li>';
      const col = (h, xs, cls) => (xs.length ? '<div class="rp-in-col ' + cls + '"><h4>' + esc(h) + '</h4><ul>' + xs.map(li).join('') + '</ul></div>' : '');
      const html = title('Actionable insights', 'for ' + ({ guard: 'a guard', wing: 'a wing', big: 'a big' }[D.group] || 'a player') + ' · read from every page of this report · ranked among ' + D.n + ' ' + D.who) +
        (D.intro ? '<p class="rp-in-intro">' + esc(D.intro) + '</p>' : '') +
        '<div class="rp-in-cols' + (D.keep.length && D.work.length ? '' : ' one') + '">' + col('What is working', D.keep, 'good') + col('What to work on', D.work, 'bad') + '</div>' +
        (D.week.length ? '<div class="rp-in-col wk"><h4>' + (F.week && F.week.picked ? 'These games' : 'This week') + '</h4><ul>' + D.week.map(li).join('') + '</ul></div>' : '');
      return [block(html, 'rp-in')];
    }
  };

  /* ---------------- LAST 7 DAYS (the weekly report) ---------------- */
  const week = {
    key: 'week', title: 'Last 7 days', page: 'LAST 7 DAYS', on: false, pack: 'flow',
    async build() {
      const W = root.EpinoiaWeekly;
      if (!W || !ctx.week) return [];
      const rep = await ctx.week();
      return [block(W.render(rep, { window: 'the last seven days', saveable: false }))];
    }
  };

  /* the later sections and the legend flow on from the one before where enough of its page is free (report.js layout,
     pack 'flow'; Louie, 2026-10-16: "no dead space") */
  const legend = { key: 'legend', title: 'Legend', on: true, pack: 'flow', free: 0.15 };      // its key alone can begin it low on a page
  /* CONNECTIONS before ON THE FLOOR WITH: shooting, then passing, then the lineups - and its half page fills what LEFT V RIGHT
     leaves, where the on/off block, a page of its own, could not go */
  return [cover, main, shots, lvr, conn, floor, wkg, week, ins, legend];
}

return { modules, passLinks, byMate };
}));
