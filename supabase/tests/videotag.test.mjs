// The video tagger (epinoia/videotag.js) and what a hand-set tag does to placement (epinoia/video.js), offline:
//
//   node supabase/tests/videotag.test.mjs
//
// What this holds them to:
//   * the play list: game order (period, clock running down, log order), descriptors left out;
//   * a tag is {seq, t, period, clock_ms}; setting, moving and removing one never edits the track it was given;
//   * placement: a tagged play sits exactly on its tag; untagged plays in its period move by the error the tags
//     showed (one tag fixes a reading that is late everywhere); with nothing read at all, plays between two
//     tags are put between them by game clock and marked approximate; nothing crosses a period;
//   * a score-only reading still lists a play a person tagged; tags survive in clock_track.manual;
//   * the timeline's arithmetic: windows, pixels and seconds both ways, ruler steps, stepping through plays;
//   * the keys the screen promises, and the three ways in (box score, video tab, a full game's watch page).
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const V = (await import('file://' + path.join(ROOT, 'epinoia', 'video.js'))).default;
globalThis.EpinoiaVideo = V;
const T = (await import('file://' + path.join(ROOT, 'epinoia', 'videotag.js'))).default;

let pass = 0, fail = 0;
const ok = (what, cond, saw) => {
  if (cond) { pass++; console.log('  PASS  ' + what); }
  else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 300))); }
};

/* a small game: Q1 and Q2, ten-minute periods, clock in ms */
const ev = (seq, period, clock, t, team = 0) => ({ seq, period, clock, t, team });
const EVENTS = [
  ev(1, 1, 600000, 'period_start', null),
  ev(2, 1, 540000, 'p2_made'), ev(3, 1, 540000, 'ast'), ev(4, 1, 480000, 'foul', 1),
  ev(5, 1, 480000, 'ft_made', 0), ev(6, 1, 480000, 'ft_made', 0), ev(7, 1, 420000, 'p3_miss', 1),
  ev(8, 1, 420000, 'reb', 0), ev(9, 1, 300000, 'to', 1), ev(10, 1, 300000, 'loc', 1),
  ev(11, 2, 600000, 'period_start', null), ev(12, 2, 540000, 'p2_made', 1), ev(13, 2, 480000, 'stl', 0)
];
const LABELS = { 2: 'Reed 2pt made', 4: 'foul', 7: 'Smith 3pt miss', 12: 'Okafor 2pt made' };

console.log('the play list');
const plays = T.playsOf(EVENTS, LABELS);
ok('descriptors are not plays (a loc is left out)', !plays.some(p => p.t === 'loc') && plays.length === EVENTS.length - 1, plays.length);
ok('in game order: period, then the clock running down, then log order',
   plays.map(p => p.seq).join(',') === '1,2,3,4,5,6,7,8,9,11,12,13', plays.map(p => p.seq).join(','));
ok('labels from the replay, the event type where there is none', plays[1].label === 'Reed 2pt made' && plays.find(p => p.seq === 9).label === 'to');
ok('structural and scoring plays are marked', plays[0].structural && plays[1].scoring && !plays[3].scoring);

console.log('tags');
const track0 = { format: 'epinoia-clock-track/1', mode: 'clock', samples: [{ t: 100, period: 1, clock_ms: 600000, conf: 0.9 }] };
const t1 = T.withTag(track0, plays[1], 130.456);
ok('a tag is {seq, t, period, clock_ms}, t to the hundredth', t1.manual.length === 1 && t1.manual[0].seq === 2 && t1.manual[0].t === 130.46 &&
   t1.manual[0].period === 1 && t1.manual[0].clock_ms === 540000, t1.manual);
ok('the track it was given is untouched (the page keeps its copy until a save works)', !track0.manual && t1.samples === track0.samples);
const t2 = T.withTag(t1, plays[1], 128);
ok('tagging the same play again moves it (one tag a play)', t2.manual.length === 1 && t2.manual[0].t === 128);
const t3 = T.withoutTag(T.withTag(t2, plays[6], 200), 2);
ok('removing a tag leaves the others', t3.manual.length === 1 && t3.manual[0].seq === 7, t3.manual);
ok('a track that did not exist starts as an empty reading with the tag', T.withTag(null, plays[1], 10).samples.length === 0 &&
   T.withTag(null, plays[1], 10).manual.length === 1);
ok('tagsOf reads them back by seq', T.tagsOf(t3).get('7').t === 200 && !T.tagsOf(t3).has('2'));

console.log('placement: a reading that is late everywhere');
/* the reader read the clock 6 s late all through Q1: every play lands 6 s after it happened */
const late = { mode: 'clock', samples: [], runs: [] };
for (let c = 600000; c >= 300000; c -= 1000) late.samples.push({ t: 1000 + (600000 - c) / 1000 + 6, period: 1, clock_ms: c, conf: 0.9 });
const video = { url: 'https://www.youtube.com/watch?v=lBeGBg_Nc6M', provider: 'youtube', clock_track: late };
const before = new Map(V.index(EVENTS, video).map(p => [p.id, p.ms]));
ok('untagged, the reading places the basket at 1066 s (6 s late)', Math.abs(before.get(2) - 1066000) < 1500, before.get(2));
const tagged = Object.assign({}, video, { clock_track: T.withTag(late, plays[1], 1060) });
const after = new Map(V.index(EVENTS, tagged).map(p => [p.id, p]));
ok('the tagged play sits exactly on its tag', after.get(2).ms === 1060000 && after.get(2).tagged === true, after.get(2));
ok('...and its untagged neighbours move by the same 6 s', Math.abs(after.get(9).ms - (before.get(9) - 6000)) < 1, [before.get(9), after.get(9).ms]);
ok('a moved neighbour is not called tagged, nor approximate', after.get(9).tagged === false && after.get(9).approx === false);
const two = Object.assign({}, video, { clock_track: T.withTag(T.withTag(late, plays[1], 1060), plays.find(p => p.seq === 9), 1306) });
const p2 = new Map(V.index(EVENTS, two).map(p => [p.id, p.ms]));
ok('between two tags the correction is interpolated by game clock (-6 s at one, 0 s at the other)',
   Math.abs(p2.get(7) - (before.get(7) - 3000)) < 1, [before.get(7), p2.get(7)]);
ok('nothing crosses a period: Q2 is placed as the reading had it', !after.has(12) || after.get(12).ms === (V.index(EVENTS, video).find(p => p.id === 12) || {}).ms);

console.log('placement: nothing read at all');
const bare = { url: 'https://www.youtube.com/watch?v=lBeGBg_Nc6M', provider: 'youtube', clock_track: { samples: [] } };
ok('no reading, no anchor, no tags: nothing placed', V.index(EVENTS, bare).length === 0);
const tb = T.withTag(T.withTag({ samples: [] }, plays[0], 500), plays.find(p => p.seq === 9), 860);
const pb = new Map(V.index(EVENTS, Object.assign({}, bare, { clock_track: tb })).map(p => [p.id, p]));
ok('two tags place the plays between them by game clock', pb.has(4) && Math.abs(pb.get(4).ms - (500000 + 360000 * (120 / 300))) < 1, pb.get(4));
ok('...marked approximate, the tags themselves not', pb.get(4).approx === true && pb.get(1).approx === false && pb.get(1).tagged === true);
ok('...and a free-throw pair on one clock is spread by log order, not stacked', pb.get(5).ms <= pb.get(6).ms);
ok('a play outside the tags (Q2) is not invented', !pb.has(12));

console.log('placement: a score-only reading');
const scoreOnly = { mode: 'score', samples: [{ t: 2000, period: 1, clock_ms: 540000, conf: 0.8 }] };
const so = Object.assign({}, bare, { clock_track: T.withTag(scoreOnly, plays.find(p => p.seq === 4), 2010) });
const sop = V.index(EVENTS, so);
ok('a score-only reading lists baskets only - and the foul a person tagged', sop.some(p => p.id === 4 && p.ms === 2010000) && !sop.some(p => p.id === 9), sop.map(p => p.id));
ok('manualTags reads clock_track.manual', V.manualTags(so).get('4') === 2010000);

console.log('the timeline');
ok('the whole broadcast when no span is chosen', JSON.stringify(T.windowOf(8395, null, 1000)) === JSON.stringify({ t0: 0, t1: 8395 }));
ok('a span centred on the playhead', JSON.stringify(T.windowOf(8395, 60, 1000)) === JSON.stringify({ t0: 970, t1: 1030 }));
ok('...held inside the video at either end', T.windowOf(8395, 60, 10).t0 === 0 && T.windowOf(8395, 60, 8390).t1 === 8395);
const w = { t0: 970, t1: 1030 };
ok('seconds to pixels and back', T.xOf(1000, w, 600) === 300 && T.tOf(300, w, 600) === 1000);
ok('a ruler label about every 90 px: 10 s on a minute across 600 px, 15 min on the whole game', T.tickStep(w, 600) === 10 && T.tickStep({ t0: 0, t1: 8395 }, 600) === 1800,
   [T.tickStep(w, 600), T.tickStep({ t0: 0, t1: 8395 }, 600)]);
ok('times read like a video player\'s', T.hms(3725) === '1:02:05' && T.hms(65.25, true) === '1:05.3' && T.clockText(425000) === '7:05');
ok('stepping through the list stops at its ends', T.step(plays, 13, +1).seq === 13 && T.step(plays, 1, -1).seq === 1 && T.step(plays, 4, +1).seq === 5);
ok('zoom runs from the whole broadcast to ten seconds', T.SPANS[0] === null && T.SPANS[T.SPANS.length - 1] === 10);

console.log('the keys and the ways in');
const keys = T.KEYS.map(k => k[0]).join(' | ');
['↓ / J', '↑ / K', 'Enter / T', 'Space', '← / →', '[ / ]', 'Delete', '+ / −', 'Ctrl+S', 'Esc'].forEach(k =>
  ok('the key list names ' + k, keys.includes(k), keys));
const vt = rd('epinoia', 'videotag.js');
ok('YouTube is steered through its message channel, no script of YouTube\'s loaded', /enablejsapi=1/.test(vt) && /func: 'seekTo'|'seekTo'/.test(vt) && !/iframe_api/.test(vt));
ok('a press on the timeline is measured in the canvas\'s own pixels (the kit zooms the body)', /canvas\.clientWidth \/ \(r\.width/.test(vt));
const html = rd('epinoia', 'game', 'index.html'), gjs = rd('epinoia', 'game', 'game.js'), tab = rd('epinoia', 'game', 'video.js');
ok('the box score has a "tag video" button, hidden until the database says this person may attach video',
   /<button class="revertcta hide" id="tagCta"/.test(html) && /function offerTagger\(\)[\s\S]*?if \(!cta \|\| !vidShown\) return;/.test(gjs));
ok('...which opens the tagger, saving through the page\'s own track save', /save: track => saveClockTrack\(track\)/.test(gjs));
ok('the video tab has "tag plays" for the same people, at the play being watched', /ctx\.canEdit && ctx\.onTag/.test(tab) && /ctx\.onTag\(st\.current\)/.test(tab));
ok('?tag=1 opens it (the watch page\'s link for a full game)', /qp\.get\('tag'\) === '1'/.test(gjs));
ok('a new reading or an imported file keeps the tags on file', /!Array\.isArray\(track\.manual\) && cur && Array\.isArray\(cur\.manual\)/.test(gjs));
const watch = rd('epinoia', 'watch', 'page.js');
ok('a full game\'s watch page offers it to an admin, linking to the game page\'s tagger', /may_attach_video/.test(watch) && /tag=1/.test(watch));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
