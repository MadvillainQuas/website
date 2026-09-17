/* ============================================================================
   pushcheck — the questions a phone that is not getting notifications raises, and
   the answers that do not need a phone (docs/notifications.md §7).

   Pure: WebCrypto (globalThis.crypto.subtle, in Deno and in Node alike) and nothing
   else. The notify Edge Function imports it; supabase/tests/pushpayload.test.mjs runs
   it under Node against RFC 8291's own worked example.

   serviceOf(endpoint)   which push service a subscription belongs to — Google (every
                         Chrome, Android and Samsung Internet phone), Apple (Safari and
                         iPhone Home Screen apps), Mozilla (Firefox) or Microsoft (Edge
                         on Windows) — or null. The notify function sends a device check
                         only to these hosts: a check is anonymous, and an allow-list is
                         what keeps it from posting to any URL somebody names.
   explain(status, svc)  what the push service's HTTP answer means for the person
                         holding the phone, and what fixes it.
   decryptPush(...)      reads an aes128gcm Web Push body with the receiving browser's
                         keys (RFC 8291). The function's self-check encrypts with
                         web-push, exactly as a real notification is encrypted, and
                         decrypts here: if this runtime's encryption were wrong, a push
                         service would still accept every notification, and every phone
                         would silently throw them away.
   vapidSigned(...)      whether the VAPID token a push service will see was signed by
                         the private key belonging to the public key browsers subscribe
                         with. If the pair does not match, every push is refused.
   ============================================================================ */

import { isApns, parseApns, explainApns } from './apns.js';

const SERVICES = [
  ['fcm', h => h === 'fcm.googleapis.com' || h === 'android.googleapis.com'],
  ['apple', h => h === 'web.push.apple.com' || h.endsWith('.push.apple.com')],
  ['mozilla', h => h === 'updates.push.services.mozilla.com' || h.endsWith('.push.services.mozilla.com')],
  ['windows', h => h.endsWith('.notify.windows.com')]
];
export const SERVICE_NAMES = Object.freeze({ fcm: 'Google', apple: 'Apple', mozilla: 'Mozilla', windows: 'Microsoft', apns: 'Apple' });

export function serviceOf(endpoint) {
  /* the Epinoia iPhone app's own address (0130): Apple's, but through APNs, not Web Push */
  if (isApns(endpoint)) return parseApns(endpoint) ? 'apns' : null;
  let u;
  try { u = new URL(String(endpoint)); } catch (_) { return null; }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return null;
  const h = u.hostname.toLowerCase();
  const hit = SERVICES.find(([, test]) => test(h));
  return hit ? hit[0] : null;
}

/* fix: null (nothing to do), 'resubscribe' (this phone signs up again), 'later', 'server' */
export function explain(status, service, detail) {
  if (service === 'apns') return explainApns(status, detail);
  const who = SERVICE_NAMES[service] || 'The push service';
  const s = Number(status) || 0;
  if (s >= 200 && s < 300) return { ok: true, fix: null, text: who + ' accepted it for this phone.' };
  if (s === 404 || s === 410) return { ok: false, fix: 'resubscribe', text: who + ' says this phone’s sign-up for notifications has expired.' };
  if (s === 401 || s === 403) return { ok: false, fix: 'resubscribe', text: who + ' refused it: this phone signed up with a key this site no longer uses.' };
  if (s === 413) return { ok: false, fix: null, text: 'The notification was too large to send.' };
  if (s === 429) return { ok: false, fix: 'later', text: who + ' asked us to slow down. Try again in a minute.' };
  if (s >= 500) return { ok: false, fix: 'later', text: who + ' had a problem just now. Try again in a minute.' };
  if (s === 0) return { ok: false, fix: 'server', text: 'The server could not send it.' };
  return { ok: false, fix: 'resubscribe', text: who + ' refused it (' + s + ').' };
}

/* ---------------------------------------------------------------- bytes --- */
export function b64u(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(text) {
  const s = String(text || '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};
const utf8 = s => new TextEncoder().encode(s);
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/* ---------------------------------------------------------- RFC 8291 --- */
/* body: the request body (salt 16 | rs 4 | idlen 1 | sender key | ciphertext).
   receiver: { privateKey: CryptoKey (ECDH P-256), publicRaw: 65 bytes }. authSecret: 16 bytes.
   The plaintext, or null when it does not decrypt. One record, as every Web Push is. */
export async function decryptPush(body, receiver, authSecret) {
  try {
    const b = body instanceof Uint8Array ? body : new Uint8Array(body);
    const salt = b.slice(0, 16);
    const idlen = b[20];
    const senderRaw = b.slice(21, 21 + idlen);
    const cipher = b.slice(21 + idlen);
    const sender = await crypto.subtle.importKey('raw', senderRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: sender }, receiver.privateKey, 256));
    const prkKey = await hmac(authSecret, ecdh);
    const ikm = await hmac(prkKey, cat(utf8('WebPush: info'), new Uint8Array([0]), receiver.publicRaw, senderRaw, new Uint8Array([1])));
    const prk = await hmac(salt, ikm);
    const cek = (await hmac(prk, cat(utf8('Content-Encoding: aes128gcm'), new Uint8Array([0, 1])))).slice(0, 16);
    const nonce = (await hmac(prk, cat(utf8('Content-Encoding: nonce'), new Uint8Array([0, 1])))).slice(0, 12);
    const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, cipher));
    let end = plain.length - 1;
    while (end >= 0 && plain[end] === 0) end--;
    if (end < 0 || plain[end] !== 2) return null;          // the last record's delimiter
    return new TextDecoder().decode(plain.slice(0, end));
  } catch (_) {
    return null;
  }
}

/* A browser's side of a subscription, made up for a self-check: the keys, and the
   p256dh / auth strings a real subscription would carry. */
export async function makeReceiver() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  return { privateKey: pair.privateKey, publicRaw, authSecret, keys: { p256dh: b64u(publicRaw), auth: b64u(authSecret) } };
}

/* authorization: the header web-push builds ("vapid t=<jwt>, k=<key>"; or the older
   "WebPush <jwt>" with the key elsewhere). publicKey: base64url, 65 bytes. */
export async function vapidSigned(authorization, publicKey) {
  try {
    const m = /(?:vapid\s+t=|WebPush\s+)([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/.exec(String(authorization || ''));
    if (!m) return false;
    const [h, p, s] = m[1].split('.');
    const key = await crypto.subtle.importKey('raw', unb64u(publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64u(s), utf8(h + '.' + p));
  } catch (_) {
    return false;
  }
}
