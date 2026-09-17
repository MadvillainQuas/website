/* ============================================================================
   pushpayload — how a notification row lands on a phone (docs/notifications.md §4).

   What fails quietly without these checks:
     * the 2-hour reminder not replacing the 2-day one, so a lock screen says
       "in 2 days" under "in 2 hours" for the same game;
     * a reminder pushed after tip-off because its TTL ignored expires_at;
     * a Topic header longer than 32 characters or outside the URL-safe alphabet,
       which a push service rejects — and the notify function would stamp the row
       as delivered anyway;
     * lineups and results arriving without the action buttons the service worker
       maps to the right page.

   Run: node supabase/tests/pushpayload.test.mjs
   ============================================================================ */
import {
  tagFor, isExpired, ttlFor, urgencyFor, topicFor, actionsFor, payloadFor, webpushOptions, testPayload
} from '../functions/_shared/pushpayload.js';

let pass = 0, fail = 0;
const eq = (got, want, what) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; return; }
  fail++; console.error(`  FAIL ${what}\n       got  ${a}\n       want ${b}`);
};
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.error(`  FAIL ${what}`); } };

const G = '52bfe03b-d70e-4924-97c1-5f02c15cdf4e';
const P = '06747c55-8882-4efe-bfdb-828aa956db7d';
const NOW = Date.parse('2026-09-19T15:00:00Z');

/* ---- tags: one slot per game per kind of news ---- */
eq(tagFor({ kind: 'fixture', game_id: G, ref: G + ':2d' }), 'fixture:' + G, 'the 2-day reminder is tagged by game');
eq(tagFor({ kind: 'fixture', game_id: G, ref: G + ':2h' }), 'fixture:' + G, '...and the 2-hour one has the same tag, so it replaces it');
eq(tagFor({ kind: 'lineups', game_id: G, ref: G + ':lineups' }), 'lineups:' + G, 'lineups get their own slot');
eq(tagFor({ kind: 'result', game_id: G, ref: G }), 'result:' + G, 'the result gets its own slot');
eq(tagFor({ kind: 'player', game_id: G, ref: G + ':' + P }), 'player:' + G + ':' + P, 'each statline gets its own slot');
eq(tagFor({ kind: 'fixture', ref: G + ':2h' }), 'fixture:' + G, 'a row without game_id falls back to its ref');
eq(tagFor({ kind: 'announcement', id: 'a1', ref: 'x' }), 'announcement:a1', 'other kinds are tagged by row');
ok(tagFor({ kind: 'lineups', game_id: G }) !== tagFor({ kind: 'result', game_id: G }), 'lineups and result never share a slot');

/* ---- expiry and TTL ---- */
const tip = '2026-09-19T17:30:00Z';
ok(!isExpired({ expires_at: tip }, NOW), 'a reminder before tip-off is not expired');
ok(isExpired({ expires_at: tip }, Date.parse(tip)), 'at tip-off it is expired');
ok(isExpired({ expires_at: '2026-09-19T14:00:00Z' }, NOW), 'after tip-off it is expired');
ok(!isExpired({ expires_at: null }, NOW), 'no expiry means never expired');
ok(!isExpired({ expires_at: 'garbage' }, NOW), 'an unreadable expiry is not treated as expired');
eq(ttlFor({ expires_at: tip }, NOW), 9000, 'TTL runs to expires_at (2.5 h = 9000 s)');
eq(ttlFor({ expires_at: '2026-09-19T15:00:30Z' }, NOW), 60, 'TTL has a 60 s floor');
eq(ttlFor({ expires_at: '2026-09-25T15:00:00Z' }, NOW), 86400, 'TTL has a 24 h ceiling');
eq(ttlFor({}, NOW), 21600, 'no expiry: 6 h');

/* ---- urgency ---- */
eq(urgencyFor({ urgency: 'high' }), 'high', 'high passes through');
eq(urgencyFor({ urgency: 'very-low' }), 'very-low', 'very-low passes through');
eq(urgencyFor({ urgency: 'urgent' }), 'normal', 'an unknown urgency becomes normal');
eq(urgencyFor({}), 'normal', 'missing urgency is normal');

/* ---- topic: <= 32 chars, URL-safe base64 alphabet, deterministic ---- */
const t1 = topicFor('fixture:' + G);
ok(t1.length > 0 && t1.length <= 32, 'the topic fits the 32-character limit');
ok(/^[A-Za-z0-9_-]+$/.test(t1), 'the topic uses only URL-safe base64 characters');
eq(topicFor('fixture:' + G), t1, 'the same tag always gives the same topic');
ok(topicFor('fixture:' + G) !== topicFor('result:' + G), 'different tags give different topics');
ok(topicFor('fixture:' + G) !== topicFor('fixture:' + P), 'different games give different topics');

/* ---- actions ---- */
eq(actionsFor({ kind: 'lineups' }), [{ action: 'starters', title: 'See lineups' }], 'lineups offer "See lineups"');
eq(actionsFor({ kind: 'result' }), [{ action: 'box', title: 'Box score' }], 'results offer "Box score"');
eq(actionsFor({ kind: 'fixture' }), [], 'reminders have no action buttons');

/* ---- the payload the service worker reads ---- */
const row = {
  id: 'n1', kind: 'lineups', game_id: G, ref: G + ':lineups',
  title: 'Lineups are in: Rockets v Lions', body: 'Rockets: Baker, Salih, Cole, Diaz, Eze',
  link: 'game/?g=' + G + '&mode=supabase&show=starters', created_at: '2026-09-19T17:05:00Z',
  expires_at: '2026-09-19T18:00:00Z', urgency: 'high'
};
const pl = payloadFor(row, 'https://prophesyscouting.co.uk/epinoia', NOW);
eq(pl.url, 'https://prophesyscouting.co.uk/epinoia/game/?g=' + G + '&mode=supabase&show=starters',
   'the url joins SITE_URL and the link with exactly one slash (SITE_URL without a trailing slash)');
eq(payloadFor({ ...row, link: '/game/?g=1' }, 'https://x.test/epinoia/', NOW).url, 'https://x.test/epinoia/game/?g=1',
   '...and with one (a leading slash on the link does not double it)');
eq(pl.tag, 'lineups:' + G, 'the payload carries the tag');
eq(pl.renotify, true, 'renotify, so a replaced notification still buzzes');
eq(pl.timestamp, Date.parse('2026-09-19T17:05:00Z'), 'the timestamp is when the news was written');
eq(pl.actions.length, 1, 'the payload carries the actions');
eq(Object.keys(pl).sort(), ['actions', 'body', 'kind', 'renotify', 'tag', 'timestamp', 'title', 'url'],
   'exactly the keys epinoia/sw.js reads');
eq(payloadFor({ kind: 'fixture' }, 'https://x.test/epinoia/', NOW).title, 'Epinoia', 'a missing title falls back');
eq(payloadFor({ kind: 'announcement', title: 'x' }, 'https://x.test/epinoia', NOW).url, 'https://x.test/epinoia/home/',
   'a row with no link opens HOME, never the splash at the site root');
eq(payloadFor({ kind: 'announcement', title: 'x', link: '' }, 'https://x.test/epinoia/', NOW).url, 'https://x.test/epinoia/home/',
   '...an empty link too');

const opts = webpushOptions(row, NOW);
eq(opts.TTL, 10800, 'web-push options: TTL to expiry');
eq(opts.urgency, 'high', 'web-push options: urgency');
eq(opts.topic, topicFor('lineups:' + G), 'web-push options: topic from the tag');

const tp = testPayload('https://x.test/epinoia', NOW);
eq(tp.url, 'https://x.test/epinoia/me/', 'the test push opens the profile page');
eq(tp.tag, 'test', 'the test push has its own slot');

/* ---- half-time: the slot full time will take over ---- */
const htClub = { kind: 'halftime', game_id: G, ref: G + ':ht', data: { audience: 'club', players: [{ id: P }] } };
const htPlayer = { kind: 'halftime', game_id: G, ref: G + ':ht', data: { audience: 'player', players: [{ id: P }, { id: 'other' }] } };
eq(tagFor(htClub), tagFor({ kind: 'result', game_id: G, ref: G }), 'a club follower\'s half-time sits in the result\'s slot, so full time replaces it');
eq(tagFor(htPlayer), tagFor({ kind: 'player', game_id: G, ref: G + ':' + P }), 'a player follower\'s half-time sits in the first player\'s statline slot');
eq(tagFor({ ...htPlayer, data: JSON.stringify(htPlayer.data) }), 'player:' + G + ':' + P, '...also when data arrives as JSON text');
eq(tagFor({ kind: 'halftime', game_id: G, ref: G + ':ht', data: { audience: 'player', players: [] } }), 'result:' + G, 'a player notice with no players falls back to the result slot');
eq(tagFor({ kind: 'halftime', game_id: G, ref: G + ':ht' }), 'result:' + G, 'no data: the result slot');
eq(actionsFor({ kind: 'halftime' }), [{ action: 'box', title: 'Box score' }], 'half-time offers "Box score"');
ok(/half-time/.test(tp.body), 'the test push mentions half-time among what will arrive');

/* ---- a device's link and crest (docs/notify-embed.md §6) ---- */
const PP = await import('../functions/_shared/pushpayload.js');
const SITE = 'https://prophesyscouting.co.uk/epinoia/';
const gameRow = { kind: 'result', game_id: G, ref: G, link: 'game/?g=' + G + '&mode=supabase' };
eq(PP.deviceUrl(gameRow, SITE, null, null), SITE + 'game/?g=' + G + '&mode=supabase', 'no pattern: Epinoia\'s game page, absolute');
eq(PP.deviceUrl(gameRow, SITE, { game_url: 'https://club.example/match/{game}' }, null), 'https://club.example/match/' + G, '{game}: the league\'s own match page');
eq(PP.deviceUrl(gameRow, SITE, { game_url: 'https://club.example/m?fiba={external}' }, '2702545'), 'https://club.example/m?fiba=2702545', '{external}: the feed\'s id');
eq(PP.deviceUrl(gameRow, SITE, { game_url: 'https://club.example/m?fiba={external}' }, null), SITE + 'game/?g=' + G + '&mode=supabase', '...and Epinoia\'s page for a game the feed does not know');
eq(PP.deviceUrl(gameRow, SITE, { game_url: 'http://club.example/match/{game}' }, null), SITE + 'game/?g=' + G + '&mode=supabase', 'a pattern that is not https is ignored');
eq(PP.deviceUrl(gameRow, SITE, { game_url: 'https://club.example/match' }, null), SITE + 'game/?g=' + G + '&mode=supabase', 'a pattern with neither token is ignored');
eq(PP.deviceUrl({ kind: 'announcement', link: '?l=slb-men' }, SITE, { home_url: 'https://club.example' }, null), 'https://club.example', 'an announcement opens the league\'s home page');
eq(PP.deviceUrl({ kind: 'announcement', link: '?l=slb-men' }, SITE, null, null), SITE + '?l=slb-men', '...or Epinoia\'s league page');
eq(PP.deviceUrl({ kind: 'test' }, SITE, { home_url: 'https://club.example/' }, null), 'https://club.example/', 'a test opens the home page');
eq(PP.deviceUrl({ kind: 'test' }, SITE, null, null), SITE + 'home/', '...or Epinoia\'s front page, HOME');
const devPl = PP.payloadFor({ kind: 'result', game_id: G, ref: G, title: 'FT', link: 'game/?g=1' }, SITE, NOW, { url: 'https://club.example/match/1', icon: 'https://x.test/crest.png' });
eq([devPl.url, devPl.icon], ['https://club.example/match/1', 'https://x.test/crest.png'], 'payloadFor takes a device\'s absolute url and the crest');
const badPl = PP.payloadFor({ kind: 'result', game_id: G, ref: G, link: 'game/?g=1' }, SITE, NOW, { url: 'javascript:alert(1)', icon: 'http://x.test/c.png' });
eq([badPl.url, 'icon' in badPl], [SITE + 'game/?g=1', false], '...but never a url or an icon that is not https');
eq(PP.crestUrl('leagues/slb/logo 1.png', 'https://abc.supabase.co'), 'https://abc.supabase.co/storage/v1/object/public/media-public/leagues/slb/logo%201.png', 'a stored crest becomes its public URL');
eq(PP.crestUrl('https://images.example/c.png', 'https://abc.supabase.co'), 'https://images.example/c.png', 'an https crest stays as it is');
eq(PP.crestUrl('{"url":"https://images.example/c.png"}', 'https://abc.supabase.co'), 'https://images.example/c.png', 'an early worker\'s JSON crest is read');
eq([PP.crestUrl('http://x/c.png', 'https://abc.supabase.co'), PP.crestUrl('', 'https://abc.supabase.co'), PP.crestUrl(null, 'x')], [null, null, null], 'no crest otherwise');

/* ============================================================================
   pushcheck — the phone questions that need no phone (docs/notifications.md §7)
   ============================================================================ */
const PC = await import('../functions/_shared/pushcheck.js');

eq(PC.serviceOf('https://fcm.googleapis.com/fcm/send/abc:def'), 'fcm', 'a Chrome or Android subscription is Google\'s');
eq(PC.serviceOf('https://web.push.apple.com/QGuQyavXutnMH'), 'apple', 'an iPhone Home Screen app\'s is Apple\'s');
eq(PC.serviceOf('https://updates.push.services.mozilla.com/wpush/v2/gAAAA'), 'mozilla', 'Firefox\'s is Mozilla\'s');
eq(PC.serviceOf('https://wns2-par02p.notify.windows.com/w/?token=x'), 'windows', 'Edge on Windows is Microsoft\'s');
eq(PC.serviceOf('https://example.com/push'), null, 'any other host is refused (a check is anonymous)');
eq(PC.serviceOf('http://fcm.googleapis.com/fcm/send/x'), null, 'plain http is refused');
eq(PC.serviceOf('https://fcm.googleapis.com:8443/fcm/send/x'), null, 'another port is refused');
eq(PC.serviceOf('https://user:pw@fcm.googleapis.com/fcm/send/x'), null, 'credentials in the URL are refused');
eq(PC.serviceOf('https://fcm.googleapis.com.evil.test/x'), null, 'a look-alike host is refused');
eq(PC.serviceOf('not a url'), null, 'garbage is refused');

eq(PC.explain(201, 'fcm'), { ok: true, fix: null, text: 'Google accepted it for this phone.' }, '201: accepted');
eq(PC.explain(410, 'apple').fix, 'resubscribe', '410: expired, sign up again');
eq(PC.explain(404, 'fcm').fix, 'resubscribe', '404: expired, sign up again');
eq(PC.explain(403, 'fcm').fix, 'resubscribe', '403: a key mismatch, sign up again');
eq(PC.explain(429, 'fcm').fix, 'later', '429: later');
eq(PC.explain(503, 'fcm').fix, 'later', '5xx: later');
eq(PC.explain(0, 'fcm').fix, 'server', '0: this server failed');

/* RFC 8291 §5, the worked example, byte for byte: the decryptor reads the RFC's body */
const RFC = {
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  plain: 'When I grow up, I want to be a watermelon'
};
const uaPub = PC.unb64u(RFC.uaPublic);
const uaKey = await crypto.subtle.importKey('jwk', {
  kty: 'EC', crv: 'P-256', d: RFC.uaPrivate, x: PC.b64u(uaPub.slice(1, 33)), y: PC.b64u(uaPub.slice(33, 65)), ext: true
}, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
eq(await PC.decryptPush(PC.unb64u(RFC.body), { privateKey: uaKey, publicRaw: uaPub }, PC.unb64u(RFC.auth)), RFC.plain,
   'decryptPush reads RFC 8291\'s example message');
const tampered = PC.unb64u(RFC.body); tampered[tampered.length - 1] ^= 1;
eq(await PC.decryptPush(tampered, { privateKey: uaKey, publicRaw: uaPub }, PC.unb64u(RFC.auth)), null, '...and refuses it with one bit flipped');
eq(await PC.decryptPush(PC.unb64u(RFC.body), { privateKey: uaKey, publicRaw: uaPub }, PC.unb64u('AAAAAAAAAAAAAAAAAAAAAA')), null, '...or with the wrong auth secret');

const rcv = await PC.makeReceiver();
ok(rcv.publicRaw.length === 65 && rcv.publicRaw[0] === 4 && PC.unb64u(rcv.keys.auth).length === 16, 'makeReceiver: an uncompressed P-256 key and a 16-byte secret');

/* vapidSigned: a token signed by the matching private key passes, any other fails */
const signer = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const signerPub = PC.b64u(new Uint8Array(await crypto.subtle.exportKey('raw', signer.publicKey)));
const jwtPart = o => PC.b64u(new TextEncoder().encode(JSON.stringify(o)));
const unsigned = jwtPart({ typ: 'JWT', alg: 'ES256' }) + '.' + jwtPart({ aud: 'https://fcm.googleapis.com', exp: 1, sub: 'mailto:x@y.z' });
const sig = PC.b64u(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signer.privateKey, new TextEncoder().encode(unsigned))));
ok(await PC.vapidSigned('vapid t=' + unsigned + '.' + sig + ', k=' + signerPub, signerPub), 'vapidSigned: the matching pair passes');
ok(await PC.vapidSigned('WebPush ' + unsigned + '.' + sig, signerPub), '...in the older WebPush header form too');
const stranger = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const strangerPub = PC.b64u(new Uint8Array(await crypto.subtle.exportKey('raw', stranger.publicKey)));
ok(!(await PC.vapidSigned('vapid t=' + unsigned + '.' + sig + ', k=' + signerPub, strangerPub)), '...a different public key fails');
ok(!(await PC.vapidSigned('Bearer nonsense', signerPub)), '...and a header without a token fails');

/* ---- the delayed test (roadmap Phase 7): notify/index.ts read as text, since Deno is not
   here. The wait is capped at 10 s, comes only after the caller is known to be signed in
   (a stranger cannot hold requests open), and sendTest's answer is unchanged. ---- */
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../functions/notify/index.ts', import.meta.url), 'utf8');
  const testBranch = src.slice(src.indexOf('if (body && body.test === true)'), src.indexOf('if (!who.trusted && !who.userId)'));
  ok(/const TEST_DELAY_MAX_S = 10;/.test(src), 'notify: the delayed test waits 10 s at most');
  ok(/Math\.min\(Math\.max\(Number\(body\.delay\) \|\| 0, 0\), TEST_DELAY_MAX_S\)/.test(testBranch),
     '...a missing, negative or non-numeric delay is no wait, and a longer one is cut to the cap');
  ok(testBranch.indexOf('if (!who.userId) return json(') >= 0 &&
     testBranch.indexOf('if (!who.userId) return json(') < testBranch.indexOf('setTimeout(resolve, delay * 1000)'),
     '...the wait comes after the sign-in check');
  ok(testBranch.indexOf('setTimeout(resolve, delay * 1000)') < testBranch.indexOf('sendTest(admin, who.userId'),
     '...and before the test is sent, whose answer keeps its shape');
  ok(/const out = await sendTest\(admin, who\.userId, site, typeof body\.endpoint === 'string' \? body\.endpoint : ''\);/.test(testBranch),
     '...sendTest is called exactly as before');
  ok(/return json\(delay > 0 \? \{ \.\.\.out, delayed: delay \} : out\);/.test(testBranch),
     '...and its answer is returned unchanged, with delayed: the seconds waited added only when it waited');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
