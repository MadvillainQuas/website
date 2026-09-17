/* ============================================================================
   apns — the iPhone app's notifications (supabase/functions/_shared/apns.js, 0130).

   What fails quietly without these checks:
     * a provider token Apple refuses (wrong header, wrong claims, a DER signature
       where JWS wants r||s), so every iPhone push is a 403 and the rows are stamped
       as sent anyway;
     * a token refreshed on every call, which Apple answers with
       TooManyProviderTokenUpdates;
     * a lineups notification not replacing the reminder for the same game, because
       the collapse id was not the web's topic;
     * a dead token (BadDeviceToken, Unregistered) kept for ever, because notify only
       drops rows on 404 and 410;
     * an iPhone row sent through web-push, or a browser's through APNs;
     * a payload over Apple's 4 KB limit.

   Run: node supabase/tests/apns.test.mjs
   ============================================================================ */
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import {
  isApns, parseApns, apnsConfig, keyBytes, providerToken, forgetToken, apnsRequest, sendApns, explainApns,
  APNS_HOSTS, DEFAULT_TOPIC
} from '../functions/_shared/apns.js';
import { serviceOf, explain, SERVICE_NAMES } from '../functions/_shared/pushcheck.js';

let pass = 0, fail = 0;
const eq = (got, want, what) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; return; }
  fail++; console.error(`  FAIL ${what}\n       got  ${a}\n       want ${b}`);
};
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.error(`  FAIL ${what}`); } };
const subtle = webcrypto.subtle;
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const TOKEN = 'a1b2c3d4'.repeat(8);
const EP = 'apns:production:' + TOKEN;
const G = '52bfe03b-d70e-4924-97c1-5f02c15cdf4e';
const NOW = Date.parse('2026-09-19T15:10:00Z');

/* ---- addresses ---- */
ok(isApns(EP) && isApns('apns:whatever'), 'an apns: endpoint is the iPhone app’s');
ok(!isApns('https://fcm.googleapis.com/fcm/send/x') && !isApns(null) && !isApns(''), 'a browser endpoint is not');
eq(parseApns(EP), { env: 'production', token: TOKEN }, 'a production address parses');
eq(parseApns('apns:sandbox:' + TOKEN), { env: 'sandbox', token: TOKEN }, 'a sandbox address parses');
eq(parseApns('apns:production:' + TOKEN.toUpperCase()), null, 'upper-case hex is not the app’s (0130 stores lower case)');
eq(parseApns('apns:staging:' + TOKEN), null, 'only production and sandbox');
eq(parseApns('apns:production:abc'), null, 'a short token is refused');
eq(serviceOf(EP), 'apns', 'pushcheck names an iPhone app address');
eq(serviceOf('apns:production:nope'), null, '...but not a malformed one');
eq(SERVICE_NAMES.apns, 'Apple', '...as Apple');
eq(serviceOf('https://web.push.apple.com/abc'), 'apple', 'Safari’s Web Push is still Web Push');

/* ---- the key ---- */
const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const der = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey));
const b64 = Buffer.from(der).toString('base64');
const PEM = '-----BEGIN PRIVATE KEY-----\n' + b64.match(/.{1,64}/g).join('\n') + '\n-----END PRIVATE KEY-----\n';
ok(keyBytes(PEM) && Buffer.from(keyBytes(PEM)).equals(Buffer.from(der)), 'the .p8 text gives the key');
ok(keyBytes(Buffer.from(PEM).toString('base64')) && Buffer.from(keyBytes(Buffer.from(PEM).toString('base64'))).equals(Buffer.from(der)),
   'so does the file base64-encoded, the way it goes through one command');
ok(keyBytes(PEM.replace(/\n/g, '\\n')) !== null, 'and a PEM whose line breaks arrived as \\n');
eq(keyBytes('not a key'), null, 'anything else is no key');

const env = { APNS_KEY_ID: 'ABC123DEFG', APNS_TEAM_ID: 'TEAM123456', APNS_KEY_P8: Buffer.from(PEM).toString('base64') };
const cfg = apnsConfig(k => env[k]);
ok(cfg.configured && cfg.topic === DEFAULT_TOPIC, 'the three secrets configure it, with the bundle id as topic');
ok(!apnsConfig(k => ({ ...env, APNS_KEY_ID: 'short' })[k]).configured, 'a key id is ten characters');
ok(!apnsConfig(() => '').configured, 'nothing set is not configured');
eq(apnsConfig(k => ({ ...env, APNS_TOPIC: 'x.y.z' })[k]).topic, 'x.y.z', 'APNS_TOPIC overrides the bundle id');

/* ---- the provider token ---- */
const dec = s => JSON.parse(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
forgetToken();
const jwt = await providerToken(cfg, NOW, subtle);
const [h, c, sig] = jwt.split('.');
eq(dec(h), { alg: 'ES256', kid: 'ABC123DEFG' }, 'the header names ES256 and the key id');
eq(dec(c), { iss: 'TEAM123456', iat: Date.parse('2026-09-19T15:00:00Z') / 1000 }, 'the claims name the team, issued on the half hour');
const raw = Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
eq(raw.length, 64, 'the signature is r||s, 64 bytes, not DER');
ok(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, raw, new TextEncoder().encode(h + '.' + c)),
   'the key’s public half verifies the token');
eq(await providerToken(cfg, NOW + 15 * 60000, subtle), jwt, 'within the half hour the same token is reused (Apple refuses faster refreshes)');
const next = await providerToken(cfg, NOW + 25 * 60000, subtle);
ok(next !== jwt && dec(next.split('.')[1]).iat === Date.parse('2026-09-19T15:30:00Z') / 1000, 'the next half hour signs a new one');

/* ---- the request ---- */
const payload = { title: 'Starting lineups', body: 'Reading Rockets v Archers', url: 'https://prophesyscouting.co.uk/epinoia/game/?g=' + G,
                  tag: 'lineups:' + G, kind: 'lineups', renotify: true, actions: [{ action: 'x' }] };
const opts = { TTL: 3600, urgency: 'high', topic: 'abcdef0123456789' };
const req = apnsRequest(JSON.stringify(payload), opts, cfg, NOW);
const body = JSON.parse(req.body);
eq(body.aps.alert, { title: 'Starting lineups', body: 'Reading Rockets v Archers' }, 'the alert carries the title and body');
eq(body.aps.sound, 'default', 'with the default sound');
eq(body.aps['thread-id'], 'game-' + G, 'grouped by game on the lock screen');
eq([body.url, body.tag, body.kind], [payload.url, payload.tag, 'lineups'], 'the link, tag and kind ride beside aps for the app');
ok(!('actions' in body) && !('renotify' in body), 'web-only fields stay behind');
eq(req.headers['apns-push-type'], 'alert', 'push type alert');
eq(req.headers['apns-topic'], DEFAULT_TOPIC, 'topic is the bundle id');
eq(req.headers['apns-priority'], '10', 'high urgency is priority 10');
eq(apnsRequest(payload, { urgency: 'normal' }, cfg, NOW).headers['apns-priority'], '10', 'normal is 10 too');
eq(apnsRequest(payload, { urgency: 'low' }, cfg, NOW).headers['apns-priority'], '5', 'low lets iOS batch it (5)');
eq(req.headers['apns-expiration'], String(NOW / 1000 + 3600), 'expiration is now + TTL, in seconds');
eq(apnsRequest(payload, { TTL: 0 }, cfg, NOW).headers['apns-expiration'], '0', 'no TTL is now or never');
eq(req.headers['apns-collapse-id'], 'abcdef0123456789', 'the collapse id is the web’s topic, so the same slot is replaced');
eq(apnsRequest({ tag: 'x'.repeat(80) }, {}, cfg, NOW).headers['apns-collapse-id'], undefined, 'a collapse id over 64 bytes is left off');
eq(JSON.parse(apnsRequest({ title: 't', url: 'http://evil.example/' }, {}, cfg, NOW).body).url, undefined, 'a link that is not https is dropped');
eq(JSON.parse(apnsRequest({ tag: 'announcement:a1' }, {}, cfg, NOW).body).aps['thread-id'], 'announcement', 'no game: grouped by kind');
const big = apnsRequest({ title: 'Big', body: 'é'.repeat(6000), url: payload.url }, opts, cfg, NOW);
ok(Buffer.byteLength(big.body) <= 4096, 'a payload over 4 KB is cut to fit (' + Buffer.byteLength(big.body) + ' bytes)');
ok(JSON.parse(big.body).aps.alert.title === 'Big' && JSON.parse(big.body).url === payload.url && /…$/.test(JSON.parse(big.body).aps.alert.body),
   '...by the body, never the title or the link');

/* ---- sending ---- */
const calls = [];
const answer = (status, reason) => async (url, init) => {
  calls.push({ url, init });
  return { status, json: async () => (reason ? { reason } : {}) };
};
forgetToken();
let r = await sendApns(EP, JSON.stringify(payload), opts, { config: cfg, fetch: answer(200), now: () => NOW, subtle });
eq(r, { ok: true, status: 200, detail: '' }, 'Apple’s 200 is a delivered push');
eq(calls[0].url, APNS_HOSTS.production + '/3/device/' + TOKEN, 'production goes to api.push.apple.com, by token');
ok(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(calls[0].init.headers.authorization) && calls[0].init.method === 'POST',
   'a POST carrying the provider token');
r = await sendApns('apns:sandbox:' + TOKEN, '{}', {}, { config: cfg, fetch: answer(200), now: () => NOW, subtle });
eq(calls[1].url, APNS_HOSTS.sandbox + '/3/device/' + TOKEN, 'sandbox goes to the sandbox host');
r = await sendApns(EP, '{}', {}, { config: cfg, fetch: answer(410, 'Unregistered'), now: () => NOW, subtle });
eq([r.status, r.ok, r.detail], [410, false, 'Apple 410 Unregistered'], 'an uninstalled app is a 410, so notify drops the row');
r = await sendApns(EP, '{}', {}, { config: cfg, fetch: answer(400, 'BadDeviceToken'), now: () => NOW, subtle });
eq([r.status, r.detail], [410, 'Apple 400 BadDeviceToken'], 'a token Apple will never take is answered 410 too, keeping Apple’s words');
r = await sendApns(EP, '{}', {}, { config: cfg, fetch: answer(400, 'DeviceTokenNotForTopic'), now: () => NOW, subtle });
eq(r.status, 410, '...as is a token for another app');
r = await sendApns(EP, '{}', {}, { config: cfg, fetch: answer(400, 'PayloadTooLarge'), now: () => NOW, subtle });
eq([r.status, r.detail], [400, 'Apple 400 PayloadTooLarge'], 'a 400 about the notification keeps the row');
const before = calls.length;
r = await sendApns(EP, '{}', {}, { config: cfg, fetch: answer(403, 'InvalidProviderToken'), now: () => NOW, subtle });
eq([r.status, r.detail], [403, 'Apple 403 InvalidProviderToken'], 'a refused key is a 403, not a dead phone');
await sendApns(EP, '{}', {}, { config: cfg, fetch: answer(200), now: () => NOW, subtle });
ok(calls[before + 1].init.headers.authorization !== calls[before].init.headers.authorization, '...and the next push signs a fresh token');
r = await sendApns(EP, '{}', {}, { config: cfg, fetch: async () => { throw new Error('connection reset'); }, now: () => NOW, subtle });
eq([r.ok, r.status, r.detail], [false, 0, 'connection reset'], 'a network failure is status 0 and never throws');
r = await sendApns(EP, '{}', {}, { config: apnsConfig(() => ''), fetch: answer(200), subtle });
ok(r.status === 0 && /not set up/.test(r.detail), 'without the secrets nothing is sent, and it says which');
r = await sendApns('apns:production:zz', '{}', {}, { config: cfg, fetch: answer(200), subtle });
eq(r.status, 410, 'a malformed address is dropped like a dead one');
r = await sendApns(EP, '{}', {}, { config: { ...cfg, key: 'garbage' }, fetch: answer(200), now: () => NOW + 7200000, subtle });
ok(r.status === 0 && /p8/.test(r.detail), 'a key that is not a .p8 says so');

/* ---- what the person is told ---- */
eq(explainApns(200).ok, true, '200 is fine');
eq(explainApns(410).fix, 'resubscribe', 'a dead token: turn notifications on again in the app');
eq(explainApns(403, 'Apple 403 InvalidProviderToken').fix, 'server', 'a refused key is Epinoia’s problem, not the phone’s');
eq(explainApns(0, 'iPhone notifications are not set up: APNS_KEY_ID').fix, 'server', 'no secrets is the server’s');
eq(explainApns(429).fix, 'later', 'slow down is later');
eq(explain(410, 'apns', 'Apple 410 Unregistered').text, explainApns(410).text, 'pushcheck.explain hands Apple’s answers to explainApns');
ok(/key this site no longer uses/.test(explain(403, 'fcm').text), 'and a browser’s 403 still reads as before');

/* ---- notify routes by address ---- */
const notify = read('../functions/notify/index.ts');
const pushFn = notify.slice(notify.indexOf('async function push('));
ok(pushFn.indexOf('isApns(s.endpoint)') > 0 && pushFn.indexOf('isApns(s.endpoint)') < pushFn.indexOf('webpush.sendNotification'),
   'push() sends an iPhone row through APNs before web-push could touch it');
ok(/const apple = service === 'apns';/.test(notify) && /!apple && \(typeof keys\.p256dh/.test(notify),
   'the anonymous check accepts the iPhone app’s address without Web Push keys');
ok(/outcome\.apns = /.test(notify) && /apnsConfig\(\(k: string\) => Deno\.env\.get\(k\)\)/.test(notify), 'the self-check reports the APNs key');
ok((notify.match(/explain\(r\.status, service, r\.detail\)/g) || []).length === 2, 'both explanations pass Apple’s reason along');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
