/* ============================================================================
   BROADCAST STATE — the same document the graphics layer renders, as JSON.

   Vizrt, Chyron, Ross XPression and vMix's data sources do not composite an
   HTML page; they poll a URL and bind fields into a template. This is that URL.

   IT IS THE SAME SHAPE AS THE BROWSER SOURCE, ON PURPOSE. A production that
   starts with an OBS layer and later moves to a proper graphics engine should
   not have to relearn the field names, and a bug fixed in one must not survive
   in the other. epinoia/broadcast/broadcast.js documents the shape; this
   produces it server-side, from the same event log through the same engine.

     GET /functions/v1/broadcast?game=<uuid>
     GET /functions/v1/broadcast?game=<uuid>&format=xml       nested, for a system
                                                              that will not take JSON
     GET /functions/v1/broadcast?game=<uuid>&format=flatxml   ONE ROW OF COLUMNS,
                                                              which is what a vMix
                                                              data source binds to
     GET /functions/v1/broadcast?game=<uuid>&format=flat      the same row as JSON

   WHY THE CLOCK IS RETURNED AS BOTH A NUMBER AND A STRING. A template that
   wants to count down locally needs the milliseconds and the server's opinion
   of "now"; one that just prints what it is given needs the string. Sending
   only the number means every integrator writes the same clock formatter, and
   they will not all agree about tenths under a minute.

   CACHING IS OFF, DELIBERATELY. A graphics engine polling twice a second
   through a CDN that decided to cache for sixty is the sort of fault that is
   invisible in rehearsal and obvious on air.
   ============================================================================ */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { deriveGame, timeoutsLeft } from '../_shared/engine.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};
const NOCACHE = { 'Cache-Control': 'no-store, must-revalidate' };

const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

const periodLabel = (p: number) => (p <= 4 ? 'Q' + p : 'OT' + (p - 4));

function mmss(ms: number) {
  const t = Math.max(0, ms || 0);
  if (t < 60000) return (Math.floor(t / 100) / 10).toFixed(1);
  const total = Math.floor(t / 1000);
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
}

const rowToEvent = (r: any) => Object.assign(
  { id: r.seq, seq: r.seq, t: r.t, team: r.team, pid: r.pid,
    period: r.period, clock: r.clock }, r.payload || {});

/* A minimal XML rendering, because several graphics engines still want one and
   the alternative is the integrator writing a converter. Attributes are avoided
   entirely: every value is an element, which is the shape a data-binding
   template expects and which cannot be broken by a club name with a quote. */
function toXML(o: any, name = 'state'): string {
  const esc = (s: unknown) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (o === null || o === undefined) return `<${name}/>`;
  if (Array.isArray(o)) return o.map(v => toXML(v, name.replace(/s$/, '') || 'item')).join('');
  if (typeof o === 'object') {
    return `<${name}>` + Object.entries(o).map(([k, v]) => toXML(v, k)).join('') + `</${name}>`;
  }
  return `<${name}>${esc(o)}</${name}>`;
}

/* ONE FLAT ROW, BECAUSE THAT IS WHAT A TITLE BINDS TO.

   The nested document above is the right shape for reading and the wrong shape
   for vMix, XPression, Chyron and CasparCG, every one of which binds a title
   field to a COLUMN of a row set. Handed {home:{score:61}} they offer the
   integrator nothing to pick; handed home_score they offer a field. So the same
   document is also served flattened to a single row of scalars -- underscored
   path names, the five on court numbered p1..p5 -- which is the difference
   between "there is an API" and "a producer can use it in the ten minutes before
   tip-off".

   A single row rather than a row per player: a scorebug is one title with many
   fields, not a table. Anything wanting a table (a box score crawl) can read the
   nested form and build its own. */
function flatten(o: any, prefix = '', out: Record<string, unknown> = {}) {
  if (o === null || o === undefined) { out[prefix] = ''; return out; }
  if (Array.isArray(o)) {
    o.forEach((v, i) => flatten(v, prefix ? `${prefix}_p${i + 1}` : `p${i + 1}`, out));
    return out;
  }
  if (typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) flatten(v, prefix ? `${prefix}_${k}` : k, out);
    return out;
  }
  out[prefix] = o;
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);
  const gameId = (url.searchParams.get('game') || url.searchParams.get('g') || '').trim();
  const format = (url.searchParams.get('format') || 'json').toLowerCase();

  const reply = (body: unknown, status = 200) => {
    const xmlHead = { ...CORS, ...NOCACHE, 'Content-Type': 'application/xml; charset=utf-8' };
    /* flatxml is the one a vMix XML data source wants: <data> with one <row> of
       scalar columns. flat is the same row as JSON, as a one-element array,
       which is what a JSON data source expects to iterate. */
    if (format === 'flatxml') {
      const row = flatten(body);
      const cols = Object.entries(row).map(([k, v]) => toXML(v, k)).join('');
      return new Response('<?xml version="1.0" encoding="UTF-8"?><data><row>' + cols + '</row></data>',
        { status, headers: xmlHead });
    }
    if (format === 'xml') {
      return new Response('<?xml version="1.0" encoding="UTF-8"?>' + toXML(body), { status, headers: xmlHead });
    }
    const out = format === 'flat' ? [flatten(body)] : body;
    return new Response(JSON.stringify(out, null, 2), {
      status, headers: { ...CORS, ...NOCACHE, 'Content-Type': 'application/json' }
    });
  };

  if (!gameId) return reply({ error: 'which game? pass ?game=<uuid>' }, 400);

  /* The anon key, so this endpoint sees exactly what the public sees — a
     graphics feed is not a reason to bypass row-level security, and a minor
     withheld from a box score must not appear in a lower third. */
  const db = createClient(URL_, ANON);

  /* Core first, garnish second. attendance, capacity and officials arrived in
     a later migration; a feed that 500s because a column it does not need is
     missing would take every graphic on air with it. */
  const CORE = 'id,status,period,home_score,away_score,venue,' +
    'roster_snapshot,starters,tip_winner,arrow_init,' +
    'home:home_team_id(name,short_name,colour),' +
    'away:away_team_id(name,short_name,colour),' +
    'competitions(name,seasons(name,leagues(name)))';

  const { data: gs, error } = await db.from('games').select(CORE).eq('id', gameId).limit(1);
  if (error) return reply({ error: error.message }, 500);
  if (!gs || !gs.length) return reply({ error: 'no such game' }, 404);
  const game: any = gs[0];

  const { data: extra } = await db.from('games')
    .select('attendance,capacity,officials').eq('id', gameId).limit(1);
  if (extra && extra.length) Object.assign(game, extra[0]);

  const { data: evRows } = await db.from('game_events')
    .select('seq,t,team,pid,period,clock,payload')
    .eq('game_id', gameId).order('seq').limit(4000);

  /* The live clock lives in game_state, which the scorer keeps current; the
     event log knows what happened but not what the clock is doing right now. */
  const { data: st } = await db.from('game_state')
    .select('period,clock_ms,running,possession,arrow,updated_at')
    .eq('game_id', gameId).maybeSingle();

  const snap = game.roster_snapshot;
  const S: any = {
    teams: (snap && snap.teams) || [
      { name: game.home?.name || 'home', color: game.home?.colour, players: [] },
      { name: game.away?.name || 'away', color: game.away?.colour, players: [] }],
    starters: game.starters || [[], []],
    events: (evRows || []).map(rowToEvent),
    period: st?.period ?? game.period ?? 1,
    clockMs: st?.clock_ms ?? 0,
    tipWinner: game.tip_winner, arrowInit: game.arrow_init,
    phase: game.status === 'final' ? 'final' : 'game'
  };

  const d = S.events.length ? deriveGame(S) : null;
  const period = S.period;

  /* The clock, advanced to now. game_state records what it was at updated_at;
     a template polling at 200ms intervals needs what it is at the moment of
     the request, or every graphic on air runs a fraction of a second behind. */
  let clockMs = st?.clock_ms ?? 0;
  let clockStale = false;
  if (st?.running && st.updated_at) {
    const since = Math.max(0, Date.now() - new Date(st.updated_at).getTime());
    /* A CLOCK NOBODY IS DRIVING STOPS, IT DOES NOT RUN OUT.

       Running the last reading forward is right for the fraction of a second
       between readings, which is what it is for, and wrong the moment the source
       stops: uncapped, a scorer who closed the tab at 8:00 of the third leaves
       every template bound to this endpoint counting down to 0:00 a few minutes
       later and sitting there. Nothing in the payload said the clock had stopped
       being a clock, and 0:00 mid-period does not read as broken, it reads as
       the game.

       The same twenty seconds the browser transport uses (CLOCK_RUN_ON_MS in
       epinoia/live.js), so a template and a layer never disagree about the clock.
       Every source refreshes far faster: the scoring app heartbeats every five
       seconds, the clock cam sends at most a second and a half apart, a feed
       every two. `stale` is published alongside so a template can dim the clock,
       or a producer can see why it has stopped. */
    const RUN_ON_MS = 20000;
    clockStale = since > RUN_ON_MS;
    clockMs = Math.max(0, clockMs - Math.min(since, RUN_ON_MS));
  }

  const card = (t: number, pid: string) => {
    const p = (S.teams[t].players || []).find((x: any) => x.id === pid) || {};
    const s = d?.stats[pid] || {};
    return {
      id: pid, number: p.num || '', name: p.name || '',
      pts: s.pts || 0, reb: (s.or || 0) + (s.dr || 0), ast: s.ast || 0,
      stl: s.stl || 0, blk: s.blk || 0, pf: s.pf || 0,
      fg: `${(s.p2m || 0) + (s.p3m || 0)}-${(s.p2a || 0) + (s.p3a || 0)}`,
      tp: `${s.p3m || 0}-${s.p3a || 0}`, ft: `${s.ftm || 0}-${s.fta || 0}`,
      min: Math.round(s.min || 0)
    };
  };

  const teamOf = (t: number) => {
    const T = d ? d.team[t] : null;
    const fouls = T?.foulsP ? (T.foulsP[period > 4 ? 4 : period] || 0) : 0;
    const src = t === 0 ? game.home : game.away;
    return {
      name: S.teams[t]?.name || '',
      short: src?.short_name || src?.name || '',
      colour: src?.colour || S.teams[t]?.color || '',
      score: d ? d.score[t] : (t === 0 ? game.home_score : game.away_score) || 0,
      periodFouls: fouls,
      bonus: fouls >= 5,
      timeoutsLeft: d ? timeoutsLeft(S, d, t) : null,
      onCourt: d ? d.onCourt[t].map((pid: string) => card(t, pid)) : []
    };
  };

  const comp = game.competitions || {};
  const season = comp.seasons || {};
  const league = season.leagues || {};
  const lastEv = d?.pbp?.length ? d.pbp[d.pbp.length - 1] : null;

  return reply({
    v: 1,
    generatedAt: new Date().toISOString(),
    game: {
      id: game.id, status: game.status,
      competition: [league.name, comp.name].filter(Boolean).join(' · ') || null,
      venue: game.venue || null,
      attendance: game.attendance ?? null,
      capacity: game.capacity ?? null,
      officials: game.officials || {}
    },
    clock: {
      /* the same substitution the browser layer makes, so a template bound to this
         and a browser source in the same show never disagree at the buzzer */
      period,
      periodLabel: game.status === 'final' ? 'FINAL' : periodLabel(period),
      ms: clockMs,
      display: game.status === 'final' ? 'FIN' : mmss(clockMs),
      final: game.status === 'final',
      running: game.status === 'final' ? false : !!st?.running,
      /* true when nothing has driven the clock for longer than it can honestly be
         run forward: the time shown is the last anybody actually saw */
      stale: clockStale,
      updatedAt: st?.updated_at ?? null
    },
    possessionArrow: st?.arrow ?? game.arrow_init ?? null,
    possession: st?.possession ?? null,
    home: teamOf(0),
    away: teamOf(1),
    lastPlay: lastEv ? { text: lastEv.txt || '', period: lastEv.period,
                         clock: mmss(lastEv.clock) } : null
  });
});
