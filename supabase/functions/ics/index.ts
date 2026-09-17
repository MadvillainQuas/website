// ============================================================================
// ics — a club's or a league's fixtures as a calendar feed (docs/calendar.md).
//
//   GET /functions/v1/ics/team/<slug or id>.ics     every game of one club
//   GET /functions/v1/ics/league/<slug>.ics         every game in a league's competitions
//   GET /functions/v1/ics?team=… / ?league=…        the same, the older query form (still served)
//   …?download=1                                    the same bytes, sent as a file to save
//
// THE PATH FORM IS THE ONE HANDED OUT. A subscription URL that ends in .ics with no query
// string is the shape every calendar client parses without surprises. Supabase routes every
// sub-path of a function to the function, so the path is read here rather than needing a
// second function.
//
// Public, unauthenticated, read-only: Google, Apple Calendar, Outlook and ICSx⁵ fetch this URL
// themselves (no headers), so the function is deployed with --no-verify-jwt and reads with the
// anon key under RLS — the same rows the public pages show. Scheduled games are two-hour events
// at their tip-off; finished ones carry the score in the title, so a subscription becomes a
// results archive too; a voided game stays as CANCELLED rather than vanishing.
//
// THE BYTES ONLY MOVE WHEN THE FIXTURES DO. Each event's DTSTAMP is the row's own last change,
// never "now", so a client that asks again with If-None-Match gets 304 and spends nothing. The
// calendar itself is built in _shared/icsfeed.js, which supabase/tests/ics.test.mjs holds to
// RFC 5545 under Node.
// ============================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { buildCalendar, feedHeaders, etagMatches } from '../_shared/icsfeed.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'if-none-match',
  'Access-Control-Expose-Headers': 'ETag, Content-Disposition'
};

/* every status a fixture can be in that is worth a place in a calendar: void is kept so a
   subscriber sees "Cancelled", not a game that quietly disappeared */
const STATUSES = ['scheduled', 'live', 'finalising', 'final', 'void'];
const SELECT = 'id,tipoff_at,status,venue,venue_address,home_score,away_score,created_at,finalised_at,reverted_at,' +
               'home:home_team_id(name,short_name),away:away_team_id(name,short_name),competitions(name)';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('use GET', { status: 405, headers: { ...cors, Allow: 'GET, HEAD, OPTIONS' } });
  }
  const url = new URL(req.url);
  const m = url.pathname.match(/\/ics\/(team|league)\/([^/]+?)(?:\.ics)?\/?$/i);
  const fromPath = (kind: string) => (m && m[1].toLowerCase() === kind ? decodeURIComponent(m[2]) : '');
  const team = (fromPath('team') || url.searchParams.get('team') || '').trim();
  const league = (fromPath('league') || url.searchParams.get('league') || '').trim();
  const download = url.searchParams.get('download') === '1';
  if (!team && !league) return new Response('team= or league= required', { status: 400, headers: cors });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
  const site = (Deno.env.get('SITE_URL') ?? 'https://prophesyscouting.co.uk/epinoia/').replace(/\/?$/, '/');
  let name = 'EPINOIΛ', rows: any[] = [];

  if (team) {
    const isId = /^[0-9a-f-]{36}$/i.test(team);
    const { data: t } = await db.from('teams').select('id,name').eq(isId ? 'id' : 'slug', team).maybeSingle();
    if (!t) return new Response('no such club', { status: 404, headers: cors });
    name = t.name;
    const { data } = await db.from('games').select(SELECT).or(`home_team_id.eq.${t.id},away_team_id.eq.${t.id}`)
      .in('status', STATUSES).order('tipoff_at', { ascending: true }).limit(400);
    rows = data ?? [];
  } else {
    const { data: l } = await db.from('leagues').select('id,name').eq('slug', league).maybeSingle();
    if (!l) return new Response('no such league', { status: 404, headers: cors });
    name = l.name;
    const { data: seasons } = await db.from('seasons').select('id').eq('league_id', l.id);
    const sids = (seasons ?? []).map((s: any) => s.id);
    const { data: comps } = sids.length ? await db.from('competitions').select('id').in('season_id', sids) : { data: [] };
    const cids = (comps ?? []).map((c: any) => c.id);
    const { data } = cids.length
      ? await db.from('games').select(SELECT).in('competition_id', cids).in('status', STATUSES)
          .order('tipoff_at', { ascending: true }).limit(1000)
      : { data: [] };
    rows = data ?? [];
  }

  const title = name + ' · EPINOIΛ';
  const body = buildCalendar({ name: title, games: rows, site });
  /* the calendar is called "<club> · EPINOIΛ" inside, but the FILE is named after the club
     alone: a file name keeps only plain characters, and EPINOIΛ without its lambda reads as
     a typo on somebody's desktop */
  const headers = { ...cors, ...feedHeaders({ name, body, download }) };
  /* the client already has these exact bytes */
  if (etagMatches(req.headers.get('if-none-match'), headers.ETag)) return new Response(null, { status: 304, headers });
  return new Response(req.method === 'HEAD' ? null : body, { headers });
});
