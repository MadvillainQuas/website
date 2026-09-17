/* ============================================================================
   pushpayload — what a notification row becomes on a phone (docs/notifications.md §4).

   Pure: no Deno, no database, no network. The notify Edge Function imports it,
   and supabase/tests/pushpayload.test.mjs runs it under Node, so the rules that
   decide how a tip-off reminder, a lineup or a result lands on a lock screen are
   tested without a phone.

   Four decisions live here:

   TAG — one lock-screen slot per game per kind of news. The 2-hour reminder
   carries the same tag as the 2-day one and REPLACES it: a phone should say what
   is true now ("in 2 hours"), not keep yesterday's "in 2 days" underneath.
   Lineups, the result and each player's statline get slots of their own, because
   they are different news about the same game (FotMob stacks them the same way).
   Half-time borrows the slot of the full-time notice that will supersede it: a club
   follower's "HT" sits in the result's slot, a player follower's in the first
   player's statline slot, so full time REPLACES half-time on the phone.

   TTL — how long the push service may hold a notification for a phone that is off
   or out of signal. A tip-off reminder delivered after tip-off is noise, so it
   lives until the row's expires_at; nothing lives longer than a day.

   URGENCY — Web Push's hint to the phone's battery manager. "In 2 hours", lineups
   and results are high; a reminder two days out can wait for the phone's next
   wake-up.

   TOPIC — a phone that was offline while the 2-day AND the 2-hour reminder were
   sent should receive one notification, the newest. A push service replaces a
   pending message that has the same Topic header, which must be at most 32
   characters from the URL-safe base64 alphabet; a hex hash of the tag is.
   ============================================================================ */

const DAY = 86400, HOUR = 3600;
const URGENCIES = ['very-low', 'low', 'normal', 'high'];

/* the game a row is about: its own column, else the first part of its ref */
function gameOf(n) {
  if (n && n.game_id) return String(n.game_id);
  const ref = n && n.ref ? String(n.ref) : '';
  return ref.split(':')[0] || '';
}

/* data may arrive parsed (supabase-js) or as the JSON text of a jsonb column */
function dataOf(n) {
  const d = n && n.data;
  if (d && typeof d === 'object') return d;
  if (typeof d === 'string') { try { const j = JSON.parse(d); return j && typeof j === 'object' ? j : {}; } catch (_) { return {}; } }
  return {};
}

export function tagFor(n) {
  const kind = String((n && n.kind) || 'note');
  const game = gameOf(n);
  if (game && kind === 'halftime') {
    const d = dataOf(n);
    const first = Array.isArray(d.players) && d.players[0] && d.players[0].id;
    return d.audience === 'player' && first ? 'player:' + game + ':' + String(first) : 'result:' + game;
  }
  if (game && (kind === 'fixture' || kind === 'lineups' || kind === 'result')) return kind + ':' + game;
  if (kind === 'player' && n.ref) return 'player:' + String(n.ref);
  return kind + ':' + String((n && (n.id || n.ref)) || '');
}

export function isExpired(n, nowMs) {
  if (!n || !n.expires_at) return false;
  const t = Date.parse(n.expires_at);
  return Number.isFinite(t) && t <= nowMs;
}

/* seconds; 60 s floor so a push service does not drop it at once, 24 h ceiling */
export function ttlFor(n, nowMs) {
  if (n && n.expires_at) {
    const t = Date.parse(n.expires_at);
    if (Number.isFinite(t)) return Math.max(60, Math.min(DAY, Math.floor((t - nowMs) / 1000)));
  }
  return 6 * HOUR;
}

export function urgencyFor(n) {
  const u = n && n.urgency;
  return URGENCIES.includes(u) ? u : 'normal';
}

/* 16 hex characters from two FNV-1a passes: deterministic, short, alphabet-safe */
export function topicFor(tag) {
  const s = String(tag || '');
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193 + 0x9e3779b9) >>> 0;
  }
  return (a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')).slice(0, 16);
}

export function actionsFor(n) {
  const kind = n && n.kind;
  if (kind === 'lineups') return [{ action: 'starters', title: 'See lineups' }];
  if (kind === 'result' || kind === 'halftime') return [{ action: 'box', title: 'Box score' }];
  return [];
}

/* the JSON the service worker receives (epinoia/sw.js reads exactly these keys) */
export function payloadFor(n, site, nowMs) {
  const base = String(site || '').replace(/\/?$/, '/');
  const link = String((n && n.link) || '').replace(/^\/+/, '');
  const created = n && n.created_at ? Date.parse(n.created_at) : NaN;
  return {
    title: String((n && n.title) || 'Epinoia'),
    body: String((n && n.body) || ''),
    url: base + link,
    tag: tagFor(n),
    renotify: true,
    kind: String((n && n.kind) || ''),
    timestamp: Number.isFinite(created) ? created : nowMs,
    actions: actionsFor(n)
  };
}

/* the options web-push's sendNotification takes */
export function webpushOptions(n, nowMs) {
  return { TTL: ttlFor(n, nowMs), urgency: urgencyFor(n), topic: topicFor(tagFor(n)) };
}

/* the test push a fan sends themselves from the profile page */
export function testPayload(site, nowMs) {
  const base = String(site || '').replace(/\/?$/, '/');
  return {
    title: 'Notifications are on',
    body: 'This is how tip-off reminders, starting lineups, half-time and full-time scores will arrive on this phone.',
    url: base + 'me/',
    tag: 'test',
    renotify: true,
    kind: 'test',
    timestamp: nowMs,
    actions: []
  };
}
