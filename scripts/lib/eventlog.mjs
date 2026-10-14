/* AN ARCHIVED GAME'S LOG, FOR THE SCRIPTS THAT READ game_events (0262, 2026-10-14).

   A game of a season that is over keeps its play-by-play as files, not rows (scripts/ingest/archive.py):
     snapshots/events/<game>.json       the log as the pages read it
     feed/archive/<game>.json.gz        the whole game, gzipped (every event row as stored)
   A script that reads a game's log from the database gets nothing for such a game. withArchive() is what it asks
   instead: the database's rows when there are any, else the file's, else the archive's - in the database's own
   shape (seq, t, team, pid, period, clock, payload), seq order - so whatever the script works out from the log comes
   out exactly as it did while the rows were there. */
import { gunzipSync } from 'node:zlib';

const COLS = ['seq', 't', 'team', 'pid', 'period', 'clock', 'payload'];
const shape = rows => rows.slice().sort((a, b) => a.seq - b.seq).map(r => Object.fromEntries(COLS.map(k => [k, r[k] ?? null])));

export async function archivedLog(url, gameId) {
  const base = String(url || '').replace(/\/+$/, '');
  try {
    const r = await fetch(`${base}/storage/v1/object/public/snapshots/events/${gameId}.json`);
    if (r.ok) {
      const j = await r.json();
      if (j && j.game === gameId && Array.isArray(j.rows) && j.rows.length) return shape(j.rows);
    }
  } catch (_) { /* the archive, below */ }
  try {
    const r = await fetch(`${base}/storage/v1/object/public/feed/archive/${gameId}.json.gz`);
    if (r.ok) {
      const j = JSON.parse(gunzipSync(Buffer.from(await r.arrayBuffer())).toString('utf8'));
      if (j && j.game === gameId && Array.isArray(j.rows)) return shape(j.rows);
    }
  } catch (_) { /* nothing archived */ }
  return null;
}

/* the database's rows, or - when it has none - the archived game's */
export async function withArchive(url, gameId, dbRows) {
  const rows = await dbRows;
  if (rows && rows.length) return rows;
  return (await archivedLog(url, gameId)) || rows || [];
}
