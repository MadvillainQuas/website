// ============================================================================
// ics — a club's fixtures as a calendar feed.
//
//   GET /functions/v1/ics?team=<slug or id>      every game of one club
//   GET /functions/v1/ics?league=<slug>          every game in a league's competitions
//
// Public, unauthenticated, read-only: Google Calendar, Apple Calendar and Outlook fetch
// this URL themselves (no headers), so the function is deployed with --no-verify-jwt and
// reads with the anon key under RLS, the same rows the public pages show. Scheduled games
// are two-hour events at their tip-off; finished ones carry the score in the title so a
// subscribed calendar becomes a results archive too. Each event's UID is the game id, so a
// re-fetch updates rather than duplicates.
// ============================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
const esc = (s: string) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const fold = (line: string) => {           // RFC 5545: lines at most 75 octets, folded with a leading space
  const out: string[] = []; let s = line;
  while (s.length > 74) { out.push(s.slice(0, 74)); s = ' ' + s.slice(74); }
  out.push(s); return out.join('\r\n');
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = new URL(req.url);
  const team = (url.searchParams.get('team') ?? '').trim();
  const league = (url.searchParams.get('league') ?? '').trim();
  if (!team && !league) return new Response('team= or league= required', { status: 400, headers: cors });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
  const site = (Deno.env.get('SITE_URL') ?? 'https://prophesyscouting.co.uk/epinoia/').replace(/\/?$/, '/');
  const sel = 'id,tipoff_at,status,venue,venue_address,home_score,away_score,home_team_id,away_team_id,' +
              'home:home_team_id(name,short_name),away:away_team_id(name,short_name),competitions(name)';
  let name = 'Epinoia', rows: any[] = [];

  if (team) {
    const isId = /^[0-9a-f-]{36}$/i.test(team);
    const { data: t } = await db.from('teams').select('id,name').eq(isId ? 'id' : 'slug', team).maybeSingle();
    if (!t) return new Response('no such club', { status: 404, headers: cors });
    name = t.name;
    const { data } = await db.from('games').select(sel).or(`home_team_id.eq.${t.id},away_team_id.eq.${t.id}`)
      .in('status', ['scheduled', 'live', 'finalising', 'final']).order('tipoff_at', { ascending: true }).limit(400);
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
      ? await db.from('games').select(sel).in('competition_id', cids).in('status', ['scheduled', 'live', 'finalising', 'final'])
          .order('tipoff_at', { ascending: true }).limit(1000)
      : { data: [] };
    rows = data ?? [];
  }

  const now = stamp(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Epinoia//fixtures//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
                 fold('X-WR-CALNAME:' + esc(name + ' · Epinoia')), 'X-WR-TIMEZONE:Europe/London', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H'];
  for (const g of rows) {
    if (!g.tipoff_at) continue;
    const start = new Date(g.tipoff_at);
    const done = g.status === 'final' || g.status === 'finalising';
    const h = g.home?.name ?? 'Home', a = g.away?.name ?? 'Away';
    const title = done && g.home_score != null ? `${h} ${g.home_score}–${g.away_score} ${a}` : `${h} v ${a}`;
    const where = [g.venue, g.venue_address].filter(Boolean).join(', ');
    const link = site + 'game/?g=' + g.id + '&mode=supabase';
    lines.push('BEGIN:VEVENT',
      'UID:' + g.id + '@epinoia',
      'DTSTAMP:' + now,
      'DTSTART:' + stamp(start),
      'DTEND:' + stamp(new Date(start.getTime() + 2 * 3600 * 1000)),
      fold('SUMMARY:' + esc(title)),
      fold('DESCRIPTION:' + esc((g.competitions?.name ? g.competitions.name + '\n' : '') + (done ? 'Final score. ' : '') + 'Box score, stats and video: ' + link)),
      fold('LOCATION:' + esc(where)),
      fold('URL:' + link),
      'STATUS:CONFIRMED',
      'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return new Response(lines.join('\r\n') + '\r\n', {
    headers: { ...cors, 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'public, max-age=1800',
               'Content-Disposition': 'inline; filename="' + name.replace(/[^A-Za-z0-9 _-]/g, '') + '.ics"' }
  });
});
