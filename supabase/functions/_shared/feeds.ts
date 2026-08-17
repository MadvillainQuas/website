// ============================================================================
// DATA FEEDS — the half that touches the world: reading a game out of the
// database, posting it, and recording what happened.
//
// The shaping and rendering live in feeds.js, which is pure and is what the
// test suite exercises. This file is deliberately thin, because everything in
// it needs a live project to run and is therefore the part that cannot be
// unit-tested.
//
// Shared between finalise-game (which fires a delivery the moment a result is
// published) and the `feeds` function (retries, previews, test sends), so a
// partner cannot receive one shape on the night and a different one on a
// resend.
// ============================================================================
export { shapeGame, render, sign, applyFieldMap } from './feeds.js';
import { shapeGame, render, sign } from './feeds.js';

export interface Feed {
  id: string; league_id: string; name: string; slug: string;
  format: string; sections: Record<string, boolean>;
  field_map: Record<string, string>;
  name_style: string; date_style: string;
  endpoint_url: string | null; signing_secret: string | null;
  enabled?: boolean;
}

export interface DeliveryResult {
  feed: string; ok: boolean; status: number; bytes: number; error: string | null;
}

/** Everything any feed could want about one game, read once. */
export async function loadGame(admin: any, gameId: string, want: Record<string, boolean>) {
  const { data: g } = await admin.from('games')
    .select('id,tipoff_at,status,venue,period,home_score,away_score,starters,' +
            'home_team_id,away_team_id,competition_id,roster_snapshot,finalised_at,' +
            'home:home_team_id(id,name,short_name,slug,colour),' +
            'away:away_team_id(id,name,short_name,slug,colour)')
    .eq('id', gameId).maybeSingle();
  if (!g) throw new Error('no such game');

  let comp: any = null, season: any = null, league: any = null;
  if (g.competition_id) {
    const { data: c } = await admin.from('competitions')
      .select('id,name,kind,season_id').eq('id', g.competition_id).maybeSingle();
    comp = c;
    if (c?.season_id) {
      const { data: s } = await admin.from('seasons')
        .select('id,name,league_id').eq('id', c.season_id).maybeSingle();
      season = s;
      if (s?.league_id) {
        const { data: l } = await admin.from('leagues')
          .select('id,name,slug').eq('id', s.league_id).maybeSingle();
        league = l;
      }
    }
  }

  const [{ data: tstats }, { data: pstats }] = await Promise.all([
    admin.from('team_game_stats').select('team_idx,stats').eq('game_id', gameId),
    admin.from('player_game_stats').select('player_id,team_idx,stats').eq('game_id', gameId)
  ]);

  const pids = [...new Set((pstats || []).map((r: any) => r.player_id))];
  const { data: people } = pids.length
    ? await admin.from('players')
        .select('id,first_name,last_name,slug,is_minor').in('id', pids)
    : { data: [] as any[] };

  let events: any[] | null = null;
  if (want.playbyplay) {
    const { data } = await admin.from('game_events')
      .select('seq,t,team,pid,period,clock,payload').eq('game_id', gameId).order('seq');
    events = data || [];
  }

  let standings: any[] | null = null;
  if (want.standings && g.competition_id) {
    const { data } = await admin.from('standings')
      .select('rank,group_name,gp,w,l,pts_for,pts_against,diff,league_points,streak,' +
              'teams(name,short_name,slug)')
      .eq('competition_id', g.competition_id)
      .order('group_name', { ascending: true, nullsFirst: true }).order('rank');
    standings = data || [];
  }

  return { g, comp, season, league, tstats: tstats || [], pstats: pstats || [],
           people: people || [], events, standings };
}

/** POST one built payload, with a hard timeout and a signature. */
export async function post(feed: Feed, body: string, contentType: string,
                          deliveryId: string): Promise<{ status: number; error: string | null }> {
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'User-Agent': 'Epinoia-Network/1 (+https://prophesyscouting.co.uk/league/api/)',
    'X-Epinoia-Event': 'game.final',
    'X-Epinoia-Delivery': deliveryId,
    'X-Epinoia-Timestamp': String(Math.floor(Date.now() / 1000))
  };
  if (feed.signing_secret) {
    headers['X-Epinoia-Signature'] = await sign(feed.signing_secret, body);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    /* redirect:'error' on purpose. Following a redirect would let a partner
       (or anyone who compromised their DNS) bounce our signed payload to an
       address that never passed the endpoint checks in migration 0037. */
    const res = await fetch(feed.endpoint_url!, {
      method: 'POST', headers, body, signal: ctrl.signal, redirect: 'error'
    });
    const err = res.ok ? null
      : ((await res.text().catch(() => '')).slice(0, 300) || res.statusText);
    return { status: res.status, error: err };
  } catch (e) {
    return { status: 0, error: String(e).slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send every delivery currently owed for a game.
 *
 * A partner being down must never fail a finalise, so nothing here throws:
 * every outcome is written to feed_deliveries and returned, and the caller
 * decides whether anyone needs telling. A failed delivery stays FAILED in the
 * queue and can be resent from the console without replaying the game.
 */
export async function dispatchGame(admin: any, gameId: string): Promise<DeliveryResult[]> {
  const { data: due } = await admin.from('feed_deliveries')
    .select('id,attempts,feed_id,data_feeds(*)')
    .eq('game_id', gameId).eq('kind', 'game').in('status', ['pending', 'failed']);
  const rows = (due || []).filter((r: any) => r.data_feeds?.enabled && r.data_feeds?.endpoint_url);
  if (!rows.length) return [];

  // one read of the game for all of them
  const want: Record<string, boolean> = {};
  rows.forEach((r: any) => {
    for (const [k, v] of Object.entries(r.data_feeds.sections || {})) if (v) want[k] = true;
  });
  const loaded = await loadGame(admin, gameId, want);

  const out: DeliveryResult[] = [];
  for (const row of rows) {
    const feed = row.data_feeds as Feed;
    let status = 0, error: string | null = null, bytes = 0;
    try {
      const { body, contentType } = render(shapeGame(loaded, feed), feed);
      bytes = new TextEncoder().encode(body).length;
      const r = await post(feed, body, contentType, row.id);
      status = r.status; error = r.error;
    } catch (e) {
      error = 'could not build the payload: ' + String(e).slice(0, 260);
    }
    const ok = status >= 200 && status < 300;

    await admin.from('feed_deliveries').update({
      status: ok ? 'sent' : 'failed',
      attempts: (row.attempts || 0) + 1,
      http_status: status || null, error, bytes,
      delivered_at: ok ? new Date().toISOString() : null
    }).eq('id', row.id);

    await admin.from('data_feeds').update({
      last_sent_at: new Date().toISOString(), last_status: status || null, last_error: error
    }).eq('id', feed.id);

    out.push({ feed: feed.name, ok, status, bytes, error });
  }
  return out;
}
