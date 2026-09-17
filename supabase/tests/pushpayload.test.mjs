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

const opts = webpushOptions(row, NOW);
eq(opts.TTL, 10800, 'web-push options: TTL to expiry');
eq(opts.urgency, 'high', 'web-push options: urgency');
eq(opts.topic, topicFor('lineups:' + G), 'web-push options: topic from the tag');

const tp = testPayload('https://x.test/epinoia', NOW);
eq(tp.url, 'https://x.test/epinoia/me/', 'the test push opens the profile page');
eq(tp.tag, 'test', 'the test push has its own slot');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
