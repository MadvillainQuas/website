// ============================================================================
// matchreport — turning a finalised game into a filed news article.
//
// Three small jobs the Edge Function should not be doing inline:
//
//   gameBrief()   the scorer's replayed state in the shape story.js reads.
//                 The browser has epinoia/game/gamefacts.js for exactly this;
//                 this is its server-side twin, and the two must agree about
//                 what a brief contains or the article and the page would be
//                 written from different inputs.
//   articleBody() the report's sections as news blocks. The news body is an
//                 array of typed blocks, never markup (migration 0051), so
//                 prose is converted rather than pasted.
//   reportSlug()  a stable, game-derived slug, which is what makes filing the
//                 report idempotent across a reopen and re-finalise.
//
// Deliberately NOT in index.ts: that file is the finalise sequence, and a
// reader following "what happens when a game ends" should not have to wade
// through block plumbing to find the next step.
// ============================================================================

/* True shooting from a derived line. The engine carries it on the advanced tab
   but not on the plain box row, and the report wants it for the efficiency
   sentences. Kept identical to epinoia/game/gamefacts.js — if these two ever
   disagree the same player would be "ruthless" in one place and ordinary in
   the other. */
export function advTS(s: any): number | null {
  const fga = (s?.p2a ?? 0) + (s?.p3a ?? 0), fta = s?.fta ?? 0;
  const den = 2 * (fga + 0.44 * fta);
  if (!den) return null;
  return (s?.pts ?? 0) / den * 100;
}

/* `game` is the scorer's state (teams, events), `d` the replayed derive(),
   `TA` the two teamAdv() results, `lineupAgg` the shared engine's aggregator. */
export function gameBrief(game: any, d: any, TA: any[], lineupAgg: Function) {
  const names = [game.teams[0].name, game.teams[1].name];

  const players: any[] = [], byId: Record<string, any> = {};
  game.teams.forEach((tm: any, t: number) => {
    (tm.players ?? []).forEach((p: any) => {
      const s = d.stats[p.id] ?? {};
      const row = { ...s, id: p.id, name: p.name, num: p.num, team: t, ts: advTS(s) };
      players.push(row);
      byId[p.id] = row;
    });
  });

  let periods = 1;
  (game.events ?? []).forEach((e: any) => { if (e.period > periods) periods = e.period; });

  return {
    names,
    score: d.score.slice(),
    players, byId,
    team: [d.team[0], d.team[1]],
    adv: [TA[0], TA[1]],
    lineups: [lineupAgg(d, 0), lineupAgg(d, 1)],
    stints: [d.lineups[0] ?? [], d.lineups[1] ?? []],
    perQ: d.perQ,
    periods,
    events: game.events ?? []
  };
}

/* One article slug per game, derived from its id.
   Short enough to read in a URL, long enough not to collide: a uuid's first
   segment is 32 bits, and a league would need tens of thousands of games
   before that mattered. */
export function reportSlug(gameId: string): string {
  return 'report-' + String(gameId).replace(/-/g, '').slice(0, 8);
}

/* The report's own escaping is for HTML; a news block holds TEXT and the
   renderer escapes on the way out, so it has to be undone here or a reader
   would see "&amp;" in a club's name. */
function unescape(s: string): string {
  return String(s)
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');          // last, so "&amp;lt;" cannot become "<"
}

const p  = (t: string) => ({ type: 'p',  spans: [{ t: unescape(t) }] });
const h2 = (t: string) => ({ type: 'h2', spans: [{ t: unescape(t) }] });

/* The report as news blocks.
   Sections become a heading and its paragraphs; the cards do not travel,
   because a news body cannot hold a rendered chart and a link to the game is
   more use than a picture of one. The closing line says where the piece came
   from — a reader is entitled to know a report was written by a machine, and
   it also points at the box score that evidences every number in it. */
export function articleBody(rep: any, gameId: string) {
  const blocks: any[] = [];
  (rep.sections ?? []).forEach((s: any) => {
    blocks.push(h2(s.heading));
    (s.paras ?? []).forEach((para: string) => blocks.push(p(para)));
  });
  blocks.push({ type: 'rule' });
  blocks.push(p('Written automatically from the play-by-play the moment this ' +
    'game was finalised. Every number above is computed from the same replay ' +
    'that draws the box score: /epinoia/game/?g=' + gameId + '&mode=supabase'));
  return blocks;
}
