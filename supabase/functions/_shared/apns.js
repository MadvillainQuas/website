/* ============================================================================
   apns — notifications for the Epinoia iPhone app, through Apple Push Notification
   service (ios/README.md, docs/notifications.md §8).

   WHY A SECOND TRANSPORT. The iPhone app shows the live site in a WKWebView, and
   WKWebView has no Web Push. The app registers with APNs itself, hands the page its
   device token, and push.js saves it as the account's phone with the endpoint
   apns:<production|sandbox>:<hex token> (0130). Everything upstream is unchanged: the
   same notification rows, the same payload (pushpayload.js), the same outcome columns.
   notify's push() asks isApns(endpoint) and sends here instead of through web-push.

   Pure: WebCrypto and an injected fetch. The notify Edge Function passes Deno's fetch,
   which speaks HTTP/2, the only protocol APNs accepts; supabase/tests/apns.test.mjs
   runs everything else under Node with a fake fetch and a generated key.

     isApns(endpoint)        the row is the iPhone app's
     parseApns(endpoint)     { env, token } or null
     apnsConfig(get)         the four secrets, read through get(name): APNS_KEY_ID,
                             APNS_TEAM_ID, APNS_KEY_P8 (the .p8 file's text, or that text
                             base64-encoded so it fits one command) and APNS_TOPIC (the
                             bundle id, uk.co.prophesyscouting.epinoia by default)
     providerToken(cfg, ms)  the ES256 JWT APNs wants, cached per half hour
     apnsRequest(p, o, cfg)  { headers, body } for one notification: payloadFor's JSON and
                             webpushOptions' TTL, urgency and topic, in APNs' terms
     sendApns(ep, p, o, d)   one push; never throws; { ok, status, detail } shaped exactly
                             like notify's push(), with a token Apple will never take
                             again answered as 410 so the row is dropped as a dead browser
                             subscription is
   ============================================================================ */

export const APNS_HOSTS = Object.freeze({
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com'
});
export const DEFAULT_TOPIC = 'uk.co.prophesyscouting.epinoia';
const ENDPOINT = /^apns:(production|sandbox):([0-9a-f]{64,200})$/;
/* APNs refuses a payload over 4 KB */
const MAX_BYTES = 4096;
/* Apple's reasons that mean this token will never work again for this app: the row goes */
const DEAD = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic']);
/* Apple's reasons that mean OUR key is the problem, not the phone */
const OURS = new Set(['InvalidProviderToken', 'ExpiredProviderToken', 'MissingProviderToken', 'BadCertificate',
                      'BadCertificateEnvironment', 'Forbidden', 'TooManyProviderTokenUpdates', 'BadTopic', 'TopicDisallowed']);

export function isApns(endpoint) {
  return typeof endpoint === 'string' && endpoint.slice(0, 5) === 'apns:';
}
export function parseApns(endpoint) {
  const m = ENDPOINT.exec(String(endpoint || ''));
  return m ? { env: m[1], token: m[2] } : null;
}

export function apnsConfig(get) {
  const read = k => { try { return String((typeof get === 'function' ? get(k) : '') || '').trim(); } catch (_) { return ''; } };
  const cfg = { keyId: read('APNS_KEY_ID'), teamId: read('APNS_TEAM_ID'), key: read('APNS_KEY_P8'),
                topic: read('APNS_TOPIC') || DEFAULT_TOPIC };
  cfg.configured = /^[A-Z0-9]{10}$/.test(cfg.keyId) && /^[A-Z0-9]{10}$/.test(cfg.teamId) && !!cfg.key;
  return cfg;
}

/* ---------------------------------------------------------------- bytes --- */
const utf8 = s => new TextEncoder().encode(s);
function b64u(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64(text) {
  const bin = atob(String(text).replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/* The key's DER bytes from the .p8 text, which may have come through a command line as
   base64 of the whole file (no line breaks survive `supabase secrets set` well) */
export function keyBytes(secret) {
  let text = String(secret || '').trim();
  if (text.indexOf('BEGIN') < 0) {
    try { text = new TextDecoder().decode(unb64(text)); } catch (_) { return null; }
  }
  const m = /-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/.exec(text.replace(/\\n/g, '\n'));
  if (!m) return null;
  try { return unb64(m[1]); } catch (_) { return null; }
}

/* ------------------------------------------------------------ the token --- */
/* ON THE HALF HOUR. APNs refuses a token refreshed more often than every 20 minutes
   (TooManyProviderTokenUpdates) and one older than an hour (ExpiredProviderToken). An iat
   rounded down to the half hour is at most 30 minutes old, changes every 30, and is the
   same for every instance of the function started in that half hour. */
const cache = { id: '', iat: 0, jwt: '', key: null, keyFor: '' };
export async function providerToken(cfg, nowMs, subtle) {
  const s = subtle || globalThis.crypto.subtle;
  const iat = Math.floor(nowMs / 1000 / 1800) * 1800;
  const id = cfg.keyId + '.' + cfg.teamId;
  if (cache.jwt && cache.id === id && cache.iat === iat) return cache.jwt;
  if (!cache.key || cache.keyFor !== id + cfg.key.length + cfg.key.slice(-12)) {
    const der = keyBytes(cfg.key);
    if (!der) throw new Error('APNS_KEY_P8 is not the .p8 file (or its base64)');
    cache.key = await s.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    cache.keyFor = id + cfg.key.length + cfg.key.slice(-12);
  }
  const head = b64u(utf8(JSON.stringify({ alg: 'ES256', kid: cfg.keyId })));
  const claims = b64u(utf8(JSON.stringify({ iss: cfg.teamId, iat })));
  /* WebCrypto's ECDSA signature is already r||s (IEEE P1363), which is what JWS wants */
  const sig = new Uint8Array(await s.sign({ name: 'ECDSA', hash: 'SHA-256' }, cache.key, utf8(head + '.' + claims)));
  cache.id = id; cache.iat = iat; cache.jwt = head + '.' + claims + '.' + b64u(sig);
  return cache.jwt;
}
export function forgetToken() { cache.jwt = ''; cache.iat = 0; }

/* ----------------------------------------------------------- the request --- */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
export function apnsRequest(payload, options, cfg, nowMs) {
  let p = payload;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch (_) { p = { body: String(payload) }; } }
  p = p && typeof p === 'object' ? p : {};
  const o = options || {};
  const tag = typeof p.tag === 'string' ? p.tag : '';
  /* one thread per game on the lock screen, as the web's tags group them */
  const game = UUID.exec(tag);
  const aps = {
    alert: { title: String(p.title || 'Epinoia'), body: String(p.body || '') },
    sound: 'default',
    'thread-id': game ? 'game-' + game[0].toLowerCase() : (tag.split(':')[0] || 'epinoia')
  };
  const body = { aps };
  if (typeof p.url === 'string' && /^https:\/\//.test(p.url)) body.url = p.url;
  if (tag) body.tag = tag;
  if (p.kind) body.kind = String(p.kind);
  /* too big: the body text gives way, never the link or the title. The longest start of the
     body that fits, found by halving, with an ellipsis to say it was cut. */
  let text = JSON.stringify(body);
  if (utf8(text).length > MAX_BYTES) {
    const full = aps.alert.body;
    let lo = 0, hi = full.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      aps.alert.body = full.slice(0, mid) + '…';
      if (utf8(JSON.stringify(body)).length <= MAX_BYTES) lo = mid; else hi = mid - 1;
    }
    aps.alert.body = lo ? full.slice(0, lo) + '…' : '';
    text = JSON.stringify(body);
  }
  const ttl = Math.max(0, Math.floor(Number(o.TTL) || 0));
  const headers = {
    'apns-push-type': 'alert',
    'apns-topic': (cfg && cfg.topic) || DEFAULT_TOPIC,
    /* 10 wakes the phone now; 5 lets iOS batch it for battery. Web Push's high and normal are
       both things a fan wants to see at once; low and very-low are not. */
    'apns-priority': o.urgency === 'low' || o.urgency === 'very-low' ? '5' : '10',
    /* 0 is "now or never", which a reminder with a TTL of 0 means too */
    'apns-expiration': ttl ? String(Math.floor(nowMs / 1000) + ttl) : '0',
    'content-type': 'application/json'
  };
  /* The web's topic (16 hex characters) replaces an older notification with the same tag;
     apns-collapse-id does the same on iOS and allows 64 bytes, so it carries the same value. */
  const collapse = typeof o.topic === 'string' && o.topic ? o.topic : tag;
  if (collapse && utf8(collapse).length <= 64) headers['apns-collapse-id'] = collapse;
  return { headers, body: text };
}

/* ---------------------------------------------------------------- a push --- */
export async function sendApns(endpoint, payload, options, deps) {
  const d = deps || {};
  const at = parseApns(endpoint);
  if (!at) return { ok: false, status: 410, detail: 'not a well-formed iPhone app address' };
  const cfg = d.config || apnsConfig(d.get);
  if (!cfg.configured) {
    return { ok: false, status: 0, detail: 'iPhone notifications are not set up: APNS_KEY_ID, APNS_TEAM_ID and APNS_KEY_P8 are needed' };
  }
  const nowMs = typeof d.now === 'function' ? d.now() : Date.now();
  const get = d.fetch || globalThis.fetch;
  try {
    const jwt = await providerToken(cfg, nowMs, d.subtle);
    const req = apnsRequest(payload, options, cfg, nowMs);
    const r = await get(APNS_HOSTS[at.env] + '/3/device/' + at.token, {
      method: 'POST', headers: Object.assign({ authorization: 'bearer ' + jwt }, req.headers), body: req.body
    });
    const status = Number(r && r.status) || 0;
    if (status >= 200 && status < 300) return { ok: true, status, detail: '' };
    let reason = '';
    try { const j = await r.json(); reason = String((j && j.reason) || ''); } catch (_) { reason = ''; }
    if (OURS.has(reason)) forgetToken();
    /* a token Apple will never take again is answered as the 410 a dead browser subscription
       gets, so notify drops the row in the same place; the detail keeps Apple's own words */
    if (DEAD.has(reason) || status === 410) {
      return { ok: false, status: 410, detail: 'Apple ' + status + (reason ? ' ' + reason : '') };
    }
    return { ok: false, status, detail: 'Apple ' + status + (reason ? ' ' + reason : '') };
  } catch (e) {
    return { ok: false, status: 0, detail: String((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 300) };
  }
}

/* What Apple's answer means for the person holding the iPhone (pushcheck.explain's shape). */
export function explainApns(status, detail) {
  const s = Number(status) || 0;
  const reason = String(detail || '');
  if (s >= 200 && s < 300) return { ok: true, fix: null, text: 'Apple accepted it for this iPhone.' };
  if (s === 410) return { ok: false, fix: 'resubscribe', text: 'Apple says this iPhone’s notification address no longer works. Open the Epinoia app and turn notifications on again.' };
  if (s === 0 && /not set up/.test(reason)) return { ok: false, fix: 'server', text: 'iPhone notifications are not set up on Epinoia’s server yet.' };
  if (s === 0) return { ok: false, fix: 'server', text: 'The server could not reach Apple.' };
  if (s === 403 || [...OURS].some(r => reason.indexOf(r) >= 0)) {
    return { ok: false, fix: 'server', text: 'Apple refused Epinoia’s sending key. This is on Epinoia’s side, not your phone.' };
  }
  if (s === 429) return { ok: false, fix: 'later', text: 'Apple asked us to slow down. Try again in a minute.' };
  if (s >= 500) return { ok: false, fix: 'later', text: 'Apple had a problem just now. Try again in a minute.' };
  return { ok: false, fix: 'server', text: 'Apple refused it (' + (reason || s) + ').' };
}
