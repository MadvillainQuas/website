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
     GET /functions/v1/broadcast?game=<uuid>&format=xml     for a system that
                                                            will not take JSON

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);
  const gameId = (url.searchParams.get('game') || url.searchParams.get('g') || '').trim();
  const format = (url.searchParams.get('format') || 'json').toLowerCase();

  const reply = (body: unknown, status = 200) => {
    if (format === 'xml') {
      return new Response('<?xml version="1.0" encoding="UTF-8"?>' + toXML(body), {
        status, headers: { ...CORS, ...NOCACHE, 'Content-Type': 'application/xml; charset=utf-8' }
      });
    }
    return new Response(JSON.stringify(body, null, 2), {
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
  if (st?.running && st.updated_at) {
    const since = Date.now() - new Date(st.updated_at).getTime();
    clockMs = Math.max(0, clockMs - Math.max(0, since));
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
      period, periodLabel: periodLabel(period),
      ms: clockMs, display: mmss(clockMs), running: !!st?.running
    },
    possessionArrow: st?.arrow ?? game.arrow_init ?? null,
    possession: st?.possession ?? null,
    home: teamOf(0),
    away: teamOf(1),
    lastPlay: lastEv ? { text: lastEv.txt || '', period: lastEv.period,
                         clock: mmss(lastEv.clock) } : null
  });
});
