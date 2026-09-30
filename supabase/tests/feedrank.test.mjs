// THE RANKED FEED (epinoia/feedrank.js): the score, the learning, and what leaves the device (nothing about the reader).
//   node supabase/tests/feedrank.test.mjs
// What is held here:
//   * the recency curve (smooth, half at 18 h, never zero), the decay of learned points (half at 30 days), the caps
//     (one obsession cannot bury a fresh story; the whole personal multiplier is bounded)
//   * the official-partner boost: only while UNREAD, in full for a week, gone two days after; a read one is ordinary
//   * the tiers: a publisher's story = a creator's piece > a league's own article > a match report; a game's significance
//     lifts its report (a cup final can outrank an ordinary story; a fresh report for a followed league can surface)
//   * variety: never more than two in a row from one source; no more than two boosted partner items in the first six
//   * the country, from a time zone or a language, unknown included; a league in it counts in full, a region-mate's less
//   * dwell, with an injected clock: only while visible and active, never idle, per-league session cap, flushed on hide
//   * storage that is blocked, throws, or is missing: everything still works
//   * personalisation off: the newest first, nothing recorded, the profile untouched; a reset clears the profile only
//   * what is fetched: the same for every reader - no read, no point, no country is ever in a request
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const FR = require(path.join(here, '..', '..', 'epinoia', 'feedrank.js'));
const { W, HOUR, DAY } = FR;

let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 400))); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

const NOW = Date.parse('2026-09-30T12:00:00Z');
const ago = h => new Date(NOW - h * HOUR).toISOString();
let seq = 0;
/* a row of news_feed (0194) */
const story = (o = {}) => Object.assign({ kind: 'outlet', id: 's' + (++seq), title: 'Story ' + seq, published_at: ago(o.h || 1), source_name: 'Eurohoops', source_slug: 'eurohoops',
  league_slug: null, league_name: null, leagues: [], author: 'A. Writer', slug: null }, o);
const piece = (o = {}) => Object.assign({ kind: 'creator', id: 'c' + (++seq), title: 'Piece ' + seq, published_at: ago(o.h || 1), source_name: 'Hoops Pod', outlet_slug: 'hoops-pod',
  league_slug: 'kbl', league_name: 'KBL', leagues: [{ slug: 'kbl', name: 'KBL' }], slug: 'p' + seq, author: 'Host' }, o);
const article = (o = {}) => Object.assign({ kind: 'league', id: 'a' + (++seq), title: 'League news ' + seq, published_at: ago(o.h || 1), source_name: 'NBL', league_slug: 'nbl', league_name: 'NBL',
  leagues: [], slug: 'a' + seq, author: 'Press office' }, o);
const report = (o = {}) => Object.assign(article(o), { author: 'Epinoia match report', slug: 'report-' + String(++seq).padStart(8, '0') });
const order = rows => rows.map(r => r.id);
const R = (rows, profile, now = NOW) => FR.rank(rows, Object.assign({}, profile), now);
const S = (row, profile, now = NOW) => FR.scoreOf(row, Object.assign({}, profile), now);
const state = () => FR.emptyState();

console.log('\nthe recency curve');
ok('fresh is 1; half of the rest at 18 hours; smaller with every hour',
   near(FR.recency(0), 1) && near(FR.recency(18 * HOUR), W.RECENCY_FLOOR + (1 - W.RECENCY_FLOOR) / 2) && FR.recency(5 * HOUR) > FR.recency(6 * HOUR) && FR.recency(HOUR) < 1);
ok('never zero, even a year on; smooth (no step between neighbouring hours)',
   FR.recency(365 * DAY) >= W.RECENCY_FLOOR && FR.recency(365 * DAY) > 0 && (() => { let worst = 0; for (let h = 0; h < 400; h++) worst = Math.max(worst, FR.recency(h * HOUR) - FR.recency((h + 1) * HOUR)); return worst < 0.04; })());
ok('a future date (a clock a little ahead) counts as fresh, not as more than fresh', near(FR.recency(-5 * HOUR), 1));

console.log('\nlearned points decay, and are bounded');
ok('a point value halves every 30 days', near(FR.decay([8, NOW - 30 * DAY], NOW), 4, 1e-6) && near(FR.decay([8, NOW - 60 * DAY], NOW), 2, 1e-6) && near(FR.decay([8, NOW], NOW), 8));
ok('nothing stored is nothing', FR.decay(undefined, NOW) === 0 && FR.decay(['x', 'y'], NOW) === 0 && FR.decay([-3, NOW], NOW) === 0);
ok('normalised by a saturating curve: never above 1, ever slower', FR.sat(1e9, W.LEAGUE_SCALE) <= 1 && FR.sat(10, 20) < FR.sat(20, 20) && FR.sat(20, 20) - FR.sat(10, 20) > FR.sat(40, 20) - FR.sat(30, 20));
{
  const hooked = state();
  hooked.l.nbl = [1e6, NOW]; hooked.p['source:eurohoops'] = [1e6, NOW];
  const obsessed = article({ h: 72, league_slug: 'nbl' });                 // three days old, a league they cannot get enough of
  const fresh = story({ h: 0.5, source_slug: 'other', source_name: 'Other' });
  const max = 1 + W.W_LEAGUE + W.W_COUNTRY + W.W_PUB;
  ok('the whole personal multiplier is capped: one obsession is 1 + the three caps, at most', S(story({ h: 1, leagues: [{ slug: 'nbl', name: 'NBL' }] }), Object.assign({}, hooked, { country: 'AU', leagueCountry: { nbl: 'AU' } })).personal <= max + 1e-9);
  ok('...so an obsession cannot bury what is fresh: a 3-day-old story of their favourite league is under a fresh one from nowhere',
     R([obsessed, fresh], hooked)[0].id === fresh.id);
}

console.log('\nthe order: fresh first, then what the reader likes');
{
  const a = story({ h: 2, source_slug: 'a', source_name: 'A' }), b = story({ h: 1, source_slug: 'b', source_name: 'B' }), c = story({ h: 30, source_slug: 'c', source_name: 'C' });
  ok('with nothing known, the newest is first (stories from three different sources)', order(R([a, b, c], state())).join() === [b, a, c].map(x => x.id).join());
  const p = state();
  p.l.nbl = [40, NOW];
  const liked = story({ h: 6, source_slug: 'd', source_name: 'D', leagues: [{ slug: 'nbl', name: 'NBL' }] });
  const plain = story({ h: 3, source_slug: 'e', source_name: 'E' });
  ok('time on a league lifts its stories above slightly fresher ones', R([plain, liked], p)[0].id === liked.id && R([plain, liked], state())[0].id === plain.id);
  const q = state(); q.p['source:eurohoops'] = [30, NOW];
  const fav = story({ h: 6 }), other = story({ h: 3, source_slug: 'f', source_name: 'F' });
  ok('...and so does a publisher they read', R([other, fav], q)[0].id === fav.id);
  ok('the rows are copies, the input is not touched, and every item has a why', (() => { const rows = [a, b]; const out = R(rows, state()); return out[0] !== b && rows[0] === a && !('why' in a) && out.every(x => typeof x.why === 'string' && x.why); })());
}

console.log('\nthe country');
ok('a time zone gives the country', FR.detectCountry('Europe/London', []) === 'GB' && FR.detectCountry('Australia/Perth', []) === 'AU' && FR.detectCountry('America/Chicago', []) === 'US' &&
   FR.detectCountry('Asia/Tokyo', []) === 'JP' && FR.detectCountry('Europe/Belgrade', []) === 'RS' && FR.detectCountry('Europe/Madrid', ['en-US']) === 'ES');
ok('a zone we have not listed is tried by its prefix (a Canadian, an Australian and a US one)', FR.detectCountry('Canada/Atlantic', []) === 'CA' && FR.detectCountry('Australia/Yancowinna', []) === 'AU' && FR.detectCountry('America/Indiana/Tell_City', []) === 'US');
ok('no zone (or an unknown one): the region of the first language that has one', FR.detectCountry('', ['fr', 'en-GB', 'de-DE']) === 'GB' && FR.detectCountry('Nowhere/Land', ['pt-BR']) === 'BR' && FR.detectCountry(undefined, 'es_MX') === 'MX');
ok('...and neither: no country', FR.detectCountry('', []) === null && FR.detectCountry('UTC', ['en']) === null && FR.detectCountry(null, null) === null && FR.detectCountry('Etc/GMT+5', ['fr']) === null);
ok('...a placeholder region is not a country', FR.detectCountry('', ['en-ZZ']) === null);
ok('a league\'s country: in the reader\'s country counts in full, a region-mate\'s less, others not at all; a list of countries counts if any is theirs',
   FR.countryMatch('GB', 'GB') === W.COUNTRY_HOME && FR.countryMatch('GB', 'IE') === W.COUNTRY_NEAR && FR.countryMatch('GB', 'JP') === 0 && FR.countryMatch('IE', 'GB+IE') === W.COUNTRY_HOME &&
   FR.countryMatch('NL', 'BE+NL') === W.COUNTRY_HOME && FR.countryMatch('BE', 'GB+NL') === W.COUNTRY_NEAR && FR.countryMatch('RS', 'XB') === W.COUNTRY_NEAR);
ok('...an unfiled league, a made-up value and no reader country count for nothing', FR.countryMatch('GB', '') === 0 && FR.countryMatch('GB', 'GBR') === 0 && FR.countryMatch('GB', null) === 0 && FR.countryMatch(null, 'GB') === 0);
{
  const gb = story({ h: 5, leagues: [{ slug: 'bbl', name: 'BBL' }], source_slug: 'a', source_name: 'A' });
  const jp = story({ h: 4, leagues: [{ slug: 'bleague', name: 'B.LEAGUE' }], source_slug: 'b', source_name: 'B' });
  const lc = { bbl: 'GB', bleague: 'JP' };
  const rows = R([jp, gb], { country: 'GB', leagueCountry: lc });
  ok('a reader in Britain sees the British league\'s story above a slightly fresher Japanese one, and it says so', rows[0].id === gb.id && rows[0].why === 'Popular where you are', rows.map(r => r.why));
  ok('...with no country known, the fresher one stays first', R([jp, gb], { country: null, leagueCountry: lc })[0].id === jp.id);
}

console.log('\nthe official partner');
const partners = new Set(['source:eurohoops', 'outlet:kbl/hoops-pod']);
{
  const p = { partners };
  const partnerFresh = story({ h: 5 });                                                       // Eurohoops, a partner
  const ordinary = story({ h: 5, source_slug: 'x', source_name: 'X' });
  ok('an unread partner story outranks an ordinary story of the same age, and says why', R([ordinary, partnerFresh], p)[0].id === partnerFresh.id && R([ordinary, partnerFresh], p)[0].why === 'Official partner');
  ok('...also a creator\'s piece from a partner outlet', R([ordinary, piece({ h: 5 })], p)[0].kind === 'creator');
  ok('the same outlet slug in another league is not the partner', (() => { const other = piece({ h: 5, league_slug: 'nbl', league_name: 'NBL' }); return S(other, p).partner === false; })());
  ok('the boost is larger than the whole personal multiplier: even the most-loved ordinary story of the same age comes second',
     (() => {
       const loved = story({ h: 5, source_slug: 'x', source_name: 'X', leagues: [{ slug: 'nbl', name: 'NBL' }] });
       const prof = Object.assign(state(), { partners, country: 'AU', leagueCountry: { nbl: 'AU' } });
       prof.l.nbl = [1e6, NOW]; prof.p['source:x'] = [1e6, NOW];
       return R([loved, partnerFresh], prof)[0].id === partnerFresh.id;
     })());
  const at = h => S(story({ h }), p).boost;
  ok('in full for a week: at 1 hour, 3 days and 6.9 days', near(at(1), W.PARTNER_BOOST) && near(at(72), W.PARTNER_BOOST) && near(at(165), W.PARTNER_BOOST));
  ok('...then it fades: less at 8 days, a little at 8.5, gone at 9 days and after; smooth and never negative',
     at(192) < W.PARTNER_BOOST && at(192) > 0 && at(204) < at(192) && at(216) === 0 && at(400) === 0 && (() => { let prev = Infinity; for (let h = 168; h <= 216; h++) { const v = at(h); if (v > prev + 1e-9 || v < 0) return false; prev = v; } return true; })());
  ok('a partner story a fortnight old is an ordinary one', (() => { const old = story({ h: 24 * 14 }); return S(old, p).boost === 0 && near(S(old, p).score, S(old, {}).score); })());
  /* read: opened by this reader */
  const prof = Object.assign(state(), { partners });
  const rd = story({ h: 5 });
  ok('it is not read yet: the boost is on', S(rd, prof).boost > 0 && S(rd, prof).read === false);
  ok('opening it (noteOpen) is the read', FR.noteOpen(prof, rd, NOW) === true && S(rd, prof).read === true);
  ok('...a read partner story loses the boost and is scored as any story of its age (the same as with no partners at all)', S(rd, prof).boost === 0 && near(S(rd, prof).score, S(rd, Object.assign({}, prof, { partners: new Set() })).score));
  ok('...and falls behind an unread partner story of the same age, and its own why is no longer "Official partner"',
     (() => { const other = story({ h: 5 }); const out = FR.rank([rd, other], prof, NOW); return out[0].id === other.id && out.find(x => x.id === rd.id).why !== 'Official partner'; })());
  ok('a read from long ago (past 60 days) is forgotten: the boost is back if it is still in the window', (() => {
    const old = story({ h: 5 }); const pr = Object.assign(state(), { partners }); pr.r[old.id] = NOW - 61 * DAY; return S(old, pr).boost > 0; })());
  /* a creator's piece is read by its page's slugs too */
  const pc = piece({ h: 3 }); const pr2 = Object.assign(state(), { partners });
  FR.noteOpen(pr2, { kind: 'creator', league_slug: 'kbl', outlet_slug: 'hoops-pod', slug: pc.slug }, NOW);        // the piece's own page: no id
  ok('a creator\'s piece opened on its own page (by its slugs, no id) is read in the feed too', S(pc, pr2).read === true && S(pc, pr2).boost === 0);
}

console.log('\nvariety');
{
  const p = { partners };
  const a = []; for (let i = 0; i < 6; i++) a.push(story({ h: 1 + i * 0.1 }));                    // six Eurohoops stories, all partners
  const b = []; for (let i = 0; i < 8; i++) b.push(story({ h: 4 + i, source_slug: 'x', source_name: 'X' }));
  const out = R(a.concat(b), p);
  const top6 = out.slice(0, 6);
  ok('no more than two boosted partner items in the first six', top6.filter(x => x.boosted).length <= 2 && top6.filter(x => x.source_slug === 'eurohoops').length <= 3, top6.map(x => x.source_slug));
  ok('...and the rest of the partner stories come after, still on top of the ordinary ones after the first six', out.slice(6).some(x => x.source_slug === 'eurohoops'));
  const runs = rows => { let worst = 1, cur = 1; for (let i = 1; i < rows.length; i++) { cur = rows[i].source_slug === rows[i - 1].source_slug ? cur + 1 : 1; worst = Math.max(worst, cur); } return worst; };
  const many = []; for (let i = 0; i < 12; i++) many.push(story({ h: 1 + i })); for (let i = 0; i < 12; i++) many.push(story({ h: 6 + i, source_slug: 'y' + (i % 3), source_name: 'Y' }));
  ok('never more than two in a row from one source', runs(R(many, {})) <= 2, R(many, {}).map(x => x.source_slug).join(' '));
  ok('...unless there is nothing else: a feed of one source is still shown, best first', R(a, {}).length === 6 && R(a, {})[0].id === a[0].id);
  ok('an empty pool, and rows with holes, do not throw', FR.rank([], {}, NOW).length === 0 && FR.rank([null, undefined, story()], {}, NOW).length === 1 && FR.rank(null, {}, NOW).length === 0);
}

console.log('\nthe tiers: a publisher\'s story, a creator\'s piece, the league\'s own article, a match report');
{
  const pub = story({ h: 6 }), cr = piece({ h: 6 }), lg = article({ h: 6 }), rp = report({ h: 6 });
  const s = { pub: S(pub, {}).score, cr: S(cr, {}).score, lg: S(lg, {}).score, rp: S(rp, {}).score };
  ok('the tiers are named: the match report is the site\'s own "Epinoia match report" (or a report-xxxxxxxx slug); nothing else is', FR.tierOf(rp) === 'report' && FR.tierOf(Object.assign({}, lg, { author: 'Epinoia match report' })) === 'report' &&
     FR.tierOf(Object.assign({}, lg, { slug: 'report-1a2b3c4d' })) === 'report' && FR.tierOf(lg) === 'league' && FR.tierOf(pub) === 'publisher' && FR.tierOf(cr) === 'creator');
  ok('on equal age and interest: publisher = creator > league-written > match report', near(s.pub, s.cr) && s.pub > s.lg && s.lg > s.rp, s);
  ok('a publisher\'s story outranks an automatic match report of the same age, and the order is the tier\'s', order(R([rp, lg, pub], {})).join() === [pub, lg, rp].map(x => x.id).join());
  ok('the tier weights are named constants in order: partner boost > publisher = creator > league > report',
     W.TIER.publisher === W.TIER.creator && W.TIER.publisher > W.TIER.league && W.TIER.league > W.TIER.report && W.PARTNER_BOOST > W.TIER.publisher);
  /* a very fresh report for a league the reader follows or has spent time on can still surface (weights, not a filter) */
  const freshReport = report({ h: 0.25, league_slug: 'nbl', league_name: 'NBL' });
  const pub6 = story({ h: 6, source_slug: 'z', source_name: 'Z' });
  ok('with no interest in the league, a fresh report is under a publisher story six hours old', R([freshReport, pub6], {})[0].id === pub6.id);
  ok('...but for a league the reader follows, a fresh report surfaces above it', R([freshReport, pub6], { followedLeagues: ['nbl'] })[0].id === freshReport.id && R([freshReport, pub6], { followedLeagues: ['nbl'] })[0].why === 'You follow NBL');
  const dw = state(); dw.l.nbl = [30, NOW];
  const pub14 = story({ h: 14, source_slug: 'z', source_name: 'Z' });
  ok('...and for a league they spend time on it surfaces above a story of half a day, though not above a fresh one',
     R([freshReport, pub14], dw)[0].id === freshReport.id && /Because you read a lot about NBL/.test(R([freshReport, pub14], dw)[0].why) && R([freshReport, pub6], dw)[0].id === pub6.id);
  ok('...but a report a day old for the same league is not (fresh matters)', R([report({ h: 26, league_slug: 'nbl', league_name: 'NBL' }), pub6], dw)[0].id === pub6.id);
  /* significance */
  const cup = report({ h: 5, league_slug: 'nbl', league_name: 'NBL' }), plain = report({ h: 5, league_slug: 'nbl', league_name: 'NBL' });
  const sig = { [cup.id]: { points: 50, reasons: ['Cup final'] }, [plain.id]: { points: 0, reasons: [] } };
  const pub5 = story({ h: 5, source_slug: 'z', source_name: 'Z' });
  ok('a report\'s base is lifted by its game\'s significance, by at most REPORT_SIG_GAIN, and only a report is lifted',
     S(cup, { sig }).base > S(plain, { sig }).base && S(cup, { sig }).base <= W.TIER.report + W.REPORT_SIG_GAIN + 1e-9 && near(S(story({ h: 1 }), { sig: { x: { points: 90 } } }).base, W.TIER.publisher));
  ok('a plain game report ranks under a publisher story; a cup final outranks an ordinary publisher story of the same age',
     R([plain, pub5], { sig })[0].id === pub5.id && R([plain, cup, pub5], { sig })[0].id === cup.id && order(R([plain, cup, pub5], { sig })).indexOf(plain.id) === 2);
  ok('...and says why: "Cup final"', R([cup, pub5], { sig })[0].why === 'Cup final');
  const top = report({ h: 5, league_slug: 'nbl', league_name: 'NBL' });
  const sig2 = { [top.id]: { points: 30 + 14 + 6, reasons: ['Top-of-the-table clash: 1st v 2nd', '34-point game: Ada Lovelace', 'Decided by 2 points'] } };
  ok('a 1st v 2nd clash with a 34-point game is worth an ordinary story\'s place (within a hair of it), a merely-good one is not',
     S(top, { sig: sig2 }).base >= 0.95 && S(top, { sig: { [top.id]: { points: 14, reasons: ['34-point game'] } } }).base < 0.7);
  ok('the significance that comes with the item (it.sig) counts as well as the profile\'s', S(Object.assign({}, plain, { sig: { points: 60, reasons: ['Final'] } }), {}).base > W.TIER.report + 0.8);
  ok('a report with no answer for its game stays at its tier, and says "Match report"', R([plain], {})[0].why === 'Match report' && R([story({ h: 9 })], {})[0].why === 'From a publisher' && R([piece({ h: 9 })], {})[0].why === 'From a creator' && R([article({ h: 9 })], {})[0].why === 'League news');
}

console.log('\nfollows and why');
{
  const fr = story({ h: 8, leagues: [{ slug: 'nbl', name: 'NBL' }] }), other = story({ h: 6, source_slug: 'q', source_name: 'Q' });
  const out = R([other, fr], { followedIds: [fr.id] });
  ok('a story from what the reader follows (in their own feed) gets a bonus; it says "You follow" the publisher', out[0].id === fr.id && out[0].why === 'You follow Eurohoops', out.map(x => x.why));
  ok('...a followed league says which', R([fr], { followedLeagues: new Set(['nbl']) })[0].why === 'You follow NBL');
  const pr = state(); pr.p['source:eurohoops'] = [20, NOW];
  ok('a publisher they read: "Because you read Eurohoops"', R([fr], pr)[0].why === 'Because you read Eurohoops');
  ok('a league they spend time on: "Because you read a lot about NBL"', (() => { const p = state(); p.l.nbl = [30, NOW]; return R([story({ h: 2, leagues: [{ slug: 'nbl', name: 'NBL' }] })], p)[0].why; })() === 'Because you read a lot about NBL');
  ok('the smallest term worth saying is a named constant: a few seconds of a league says nothing about it', (() => { const p = state(); p.l.nbl = [0.2, NOW]; return R([story({ h: 2, leagues: [{ slug: 'nbl', name: 'NBL' }] })], p)[0].why; })() === 'From a publisher');
}

console.log('\nwhat is learned (pure)');
{
  const st = state();
  const cr = piece({ h: 1 });
  ok('opening a piece: read, its outlet gains OPEN_PTS and its leagues a little', FR.noteOpen(st, cr, NOW) && st.r[cr.id] === NOW && near(st.p['outlet:kbl/hoops-pod'][0], W.OPEN_PTS) && near(st.l.kbl[0], W.OPEN_LEAGUE_PTS));
  ok('...only the first time: opening it again is not a second reason', FR.noteOpen(st, cr, NOW + 1000) === false && near(st.p['outlet:kbl/hoops-pod'][0], W.OPEN_PTS));
  FR.noteVisit(st, 'source:eurohoops', NOW); FR.noteFollow(st, { key: 'source:eurohoops', league: 'nbl' }, NOW);
  ok('a visit and a follow add their points', near(st.p['source:eurohoops'][0], W.VISIT_PTS + W.FOLLOW_PTS) && near(st.l.nbl[0], W.FOLLOW_LEAGUE_PTS));
  ok('points earned earlier decay before the new ones are added', (() => { const s2 = state(); FR.addPoints(s2.l, 'x', 10, NOW - 30 * DAY); FR.addPoints(s2.l, 'x', 1, NOW); return near(s2.l.x[0], 6, 1e-3); })());
  FR.noteShown(st, ['i1', 'i2', 'i1', ''], NOW); FR.noteShown(st, ['i1'], NOW + 10);
  ok('impressions are kept apart from reads, counted once per call', st.i.i1[0] === 2 && st.i.i2[0] === 1 && !st.r.i1);
  const imp = state(); imp.i.z = [W.IMPRESSION_HARD_AT, NOW];
  const seenLots = story({ id: 'z', h: 3 }), unseen = story({ h: 3, source_slug: 'u', source_name: 'U' });
  ok('a story shown many times and never opened slips a little', S(seenLots, imp).score < S(unseen, imp).score && S(seenLots, imp).imp === W.IMPRESSION_HARD);
  const big = state();
  for (let i = 0; i < W.READS_MAX + 100; i++) big.r['id' + i] = NOW - i * 1000;
  for (let i = 0; i < W.LEAGUES_MAX + 30; i++) big.l['l' + i] = [10, NOW - i * 1000];
  big.r.old = NOW - (W.READS_TTL_DAYS + 1) * DAY; big.l.faded = [0.06, NOW - 60 * DAY];
  FR.prune(big, NOW);
  ok('the profile stays small: reads and leagues are capped to the newest, old reads and faded points forgotten',
     Object.keys(big.r).length <= W.READS_MAX && Object.keys(big.l).length <= W.LEAGUES_MAX && !('old' in big.r) && !('faded' in big.l) && 'id0' in big.r);
  ok('junk stored is not a profile: a wrong version or shape is an empty one', JSON.stringify(FR.sane({ v: 2, l: { a: [1, 2] } })) === JSON.stringify(state()) && JSON.stringify(FR.sane(null)) === JSON.stringify(state()) &&
     Object.keys(FR.sane({ v: 1, l: { a: [1, NOW], b: 'nope', c: [NaN, 1] } }).l).join() === 'a');
}

console.log('\ndwell: what counts');
{
  let t = NOW, visible = true, slug = 'nbl';
  const got = [];
  const tr = FR.dwellTracker({ now: () => t, visible: () => visible, slug: () => slug, add: (s, sec) => got.push([s, sec]) });
  const step = (ms, act) => { t += ms; if (act) tr.activity(); return tr.tick(); };
  ok('a reader who is active: every second since the last tick counts', step(5000, true) === 5 && step(5000, true) === 5);
  ok('...and stays counted for 30 s after their last touch (six ticks of five seconds)', [1, 2, 3, 4, 5, 6].every(() => step(5000, false) === 5));
  ok('...then nothing while they sit idle (only the seconds inside the window count)', step(5000, false) === 0 && step(60000, false) === 0);
  ok('...a long idle gap counts only the part of it inside the window (a touch, then 50 s of nothing: 30 s)', (() => { step(5000, true); return step(50000, false) === 30; })());
  ok('...and a touch brings it back', step(5000, true) === 5);
  tr.visibility(false);
  ok('while the tab is hidden nothing counts, touched or not', step(60000, true) === 0 && step(60000, false) === 0);
  tr.visibility(true);
  ok('shown again: counting resumes from that moment (the hidden minutes are not back-filled)', step(5000, true) === 5);
  slug = 'kbl'; step(5000, true); slug = null; step(5000, true);
  const pend = tr.pending();
  ok('what is counted goes to the league the page is about at the time; a page with no league counts for none', pend.nbl > 0 && pend.kbl === 5 && Object.keys(pend).join() === 'nbl,kbl', pend);
  tr.flush();
  ok('flush hands the seconds over once and empties', got.length === 2 && got.find(x => x[0] === 'kbl')[1] === 5 && Object.keys(tr.pending()).length === 0);
  const t2 = { v: 0 };
  const idle = FR.dwellTracker({ now: () => t2.v, visible: () => true, slug: () => 'x', add: () => {} });
  t2.v = 8 * 3600 * 1000; idle.tick();
  ok('a laptop asleep for eight hours with the tab "visible" counts at most the 30 s window', idle.pending().x <= 30, idle.pending());
  const hid = FR.dwellTracker({ now: () => t2.v, visible: () => false, slug: () => 'x', add: () => {} });
  t2.v += 10000; hid.activity(); hid.tick();
  ok('a tab that starts hidden counts nothing', Object.keys(hid.pending()).length === 0);
}
{
  const st = state(), sess = {};
  ok('a minute of dwell is a point; fractions count', near((FR.addDwell(st, 'nbl', 60, NOW, sess), st.l.nbl[0]), W.DWELL_PTS_PER_MIN) && near((FR.addDwell(st, 'nbl', 30, NOW, sess), st.l.nbl[0]), 1.5));
  const sess2 = {};
  const credited = [FR.addDwell(st, 'kbl', 600, NOW, sess2), FR.addDwell(st, 'kbl', 600, NOW, sess2), FR.addDwell(st, 'kbl', 600, NOW, sess2)];
  ok('at most DWELL_SESSION_CAP_S a league a session: 600 + 300, then nothing', credited.join() === '600,300,0' && near(st.l.kbl[0], W.DWELL_SESSION_CAP_S / 60 * W.DWELL_PTS_PER_MIN, 1e-6), credited);
  ok('...a different league in the same session has its own allowance', FR.addDwell(st, 'bbl', 100, NOW, sess2) === 100);
  ok('no league or no time is nothing', FR.addDwell(st, '', 30, NOW, {}) === 0 && FR.addDwell(st, 'x', 0, NOW, {}) === 0 && FR.addDwell(st, 'x', -5, NOW, {}) === 0);
  ok('the pages that count are a league\'s own (its front page, table, club, player, game, stats, news, creators), not the platform\'s',
     ['/epinoia/', '/epinoia/index.html', '/epinoia/l/', '/epinoia/t/', '/epinoia/p/', '/epinoia/game/', '/epinoia/stats/', '/epinoia/stats/wowy/', '/epinoia/fixtures/', '/epinoia/news/', '/epinoia/creators/'].every(FR.dwellPage) &&
     ['/epinoia/home/', '/epinoia/games/', '/epinoia/scouting/', '/epinoia/go/', '/epinoia/me/', '/epinoia/admin/', '/epinoia/privacy/', '/epinoia/signin/'].every(p => !FR.dwellPage(p)));
}

console.log('\nthe store: storage that is missing, blocked, or broken');
{
  const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, _m: m }; };
  const boom = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  const full = Object.assign(mem(), { setItem(k, v) { if (String(v).length > 50) throw new Error('quota'); this._m[k] = String(v); } });
  const clock = { t: NOW };
  const make = (local, session) => FR.createStore({ local, session, now: () => clock.t });

  const a = make(mem(), mem());
  a.opened(story({ id: 'x1' })); a.dwell('nbl', 120); a.visited('source:eurohoops');
  const p = a.profile();
  ok('on a working store: reads, dwell and visits are kept and read back', p.r.x1 && near(p.l.nbl[0], 2) && p.p['source:eurohoops'] && a.isRead('x1') && a.learned() >= 3);

  const b = make(boom, boom);
  ok('storage that throws on every access: nothing throws, and this page still learns in memory',
     (() => { try { b.opened(story({ id: 'y1' })); b.dwell('kbl', 60); b.shown(['q']); b.setEnabled(true); return b.enabled() && b.isRead('y1') && near(b.profile().l.kbl[0], 1) && b.reset() === true && !b.isRead('y1'); } catch (e) { return String(e); } })());
  const c = make(null, null);
  ok('no storage at all (null): the same, in memory', (() => { try { c.opened(story({ id: 'z1' })); c.dwell('kbl', 60); return c.isRead('z1') && c.enabled() && c.profile().l.kbl; } catch (e) { return String(e); } })());
  ok('...and it can be switched off and on again in memory too', (() => { c.setEnabled(false); const off = c.enabled(); c.opened(story({ id: 'z2' })); c.setEnabled(true); return off === false && !c.isRead('z2'); })());
  const d = make(full, mem());
  ok('a store that refuses a big write (quota) does not throw; the profile is kept small or in memory', (() => { try { for (let i = 0; i < 20; i++) d.opened(story({ id: 'big' + i })); return d.isRead('big19'); } catch (e) { return String(e); } })());
  const garbage = mem(); garbage.setItem(W.KEY, '{not json');
  ok('a profile that is not JSON is an empty one', make(garbage, mem()).profile().r && Object.keys(make(garbage, mem()).profile().r).length === 0);

  /* personalisation off */
  const st = make(mem(), mem());
  st.opened(story({ id: 'k1' })); st.dwell('nbl', 120);
  const before = JSON.stringify(st.profile());
  st.setEnabled(false);
  st.opened(story({ id: 'k2' })); st.dwell('nbl', 300); st.visited('source:x'); st.followed({ league: 'nbl' }); st.shown(['k3']);
  ok('switched off: nothing is recorded, and what was learned is left exactly as it was', st.enabled() === false && JSON.stringify(st.profile()) === before);
  const rows = [story({ h: 9, source_slug: 'a', source_name: 'A' }), story({ h: 2, source_slug: 'b', source_name: 'B' }), story({ h: 5, source_slug: 'c', source_name: 'C' })];
  const prof = st.profile(); prof.l.nbl = [90, NOW]; prof.partners = partners; prof.off = !st.enabled();
  const offOrder = FR.rank(rows, prof, NOW);
  ok('...and the feed is the newest first, whatever the profile says: no boost, no why', order(offOrder).join() === [rows[1], rows[2], rows[0]].map(r => r.id).join() && offOrder.every(x => x.why === ''));
  ok('...also with no profile at all', order(FR.rank(rows, null, NOW)).join() === order(offOrder).join());
  st.setEnabled(true);
  ok('switched on again: it learns again, from where it was', (() => { st.opened(story({ id: 'k9' })); return st.isRead('k9') && st.isRead('k1') && !st.isRead('k2'); })());
  st.reset();
  ok('a reset forgets what was learned and keeps the switch (and it is only the profile: the follows are the account\'s)', st.learned() === 0 && st.enabled() === true && (() => { st.setEnabled(false); st.reset(); return st.enabled() === false; })());
  ok('the switch and the profile live under their own keys, so a reset cannot switch anything back on', (() => { const l = mem(); const s2 = make(l, mem()); s2.opened(story({ id: 'q1' })); s2.setEnabled(false); s2.reset(); return l.getItem(W.OFF_KEY) === '1' && l.getItem(W.KEY) === null; })());
}

console.log('\nwhat leaves the device: nothing about the reader');
{
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, body: init && init.body ? String(init.body) : '', method: (init && init.method) || 'GET', headers: (init && init.headers) || {} });
    const ok_ = j => ({ ok: true, status: 200, json: async () => j });
    if (/official_partners/.test(url)) return ok_([{ kind: 'source', slug: 'eurohoops' }, { kind: 'outlet', slug: 'hoops-pod', league: 'kbl' }]);
    if (/leagues\?/.test(url)) return ok_([{ id: 'L-nbl', slug: 'nbl', country: 'AU' }, { id: 'L-kbl', slug: 'kbl', country: 'KR' }]);
    if (/news_report_significance/.test(url)) { const ids = JSON.parse(init.body).p_article_ids; return ok_(ids.map(id => ({ article_id: id, game_id: 'g', points: 50, reasons: ['Cup final'] }))); }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; };
  const store = FR.createStore({ local: mem(), session: mem(), now: () => NOW });
  const net = FR.createNet({ fetch: fakeFetch, config: { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon' }, local: mem(), now: () => NOW });
  /* a reader with a history */
  store.opened(story({ id: 'read-1' })); store.dwell('nbl', 600); store.visited('source:eurohoops');
  const rp = report({ h: 3, league_slug: 'nbl', league_name: 'NBL' });
  const pool = [story({ h: 2 }), rp, piece({ h: 4 })];
  const res = await FR.rankRows(pool, { store, net, now: NOW, country: 'AU', followedIds: ['read-1'] });
  const wire = calls.map(c => c.url + ' ' + c.body).join('\n');
  ok('ranking works end to end: the partners, the countries and the report\'s points come from the public calls', res.ranked === true && res.partners.has('source:eurohoops') && res.rows.length === 3 && res.rows.some(r => r.why === 'Cup final'), res.rows.map(r => r.why));
  ok('what was asked: the partners, the leagues\' countries, the match reports\' points - and only those', calls.length === 3 && calls.every(c => /official_partners|leagues\?select=id,slug,country|news_report_significance/.test(c.url)), calls.map(c => c.url));
  ok('the points of a report are asked for by the ARTICLE ids in the candidate pool, which every reader has', calls.find(c => /significance/.test(c.url)).body === JSON.stringify({ p_article_ids: [rp.id] }));
  ok('nothing about the reader is in any request: not what they read, the leagues they like, the publishers they open, their country, their time on a page',
     !/read-1|nbl|kbl|eurohoops|hoops-pod|\bAU\b|dwell|profile|reads|followed/i.test(wire), wire);
  ok('...every request is a POST or GET to a public function with the anon key alone (no session, no token: a reader is no one)',
     calls.every(c => (c.method === 'POST' || c.method === 'GET') && Object.keys(c.headers).every(k => /^(apikey|content-type|accept)$/i.test(k))));
  const n0 = calls.length;
  await FR.rankRows(pool, { store, net, now: NOW, country: 'AU' });
  ok('the partners and the leagues\' countries are asked once per page (cached), the significance for each report once', calls.length === n0 && (await net.partners()).size === 2);
  store.setEnabled(false);
  const off = await FR.rankRows(pool, { store, net, now: NOW });
  ok('personalisation off: ranked is false and the order is the newest first', off.ranked === false && order(off.rows).join() === order(pool.slice().sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))).join());
  ok('...and the partners list is still there for the pill', off.partners.has('source:eurohoops'));
  const dead = FR.createNet({ fetch: async () => { throw new Error('offline'); }, config: { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'a' }, local: null, now: () => NOW });
  store.setEnabled(true);
  const still = await FR.rankRows(pool, { store, net: dead, now: NOW, country: 'AU' });
  ok('with every call failing (offline, or a database without 0197 / 0198): the ranking still works, with no partners and the reports at their tier', still.ranked === true && still.rows.length === 3 && still.partners.size === 0);
  /* a database without the migrations: asked once, then left alone for a while (every page would otherwise ask) */
  {
    const l = mem(), ss = mem(); let n404 = 0;
    const f404 = async () => { n404++; return { ok: false, status: 404, json: async () => ({}) }; };
    const cfg = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'a' };
    const one = FR.createNet({ fetch: f404, config: cfg, local: l, session: ss, now: () => NOW });
    await one.partners(); await one.significance(pool); await one.significance([report({ h: 1 })]);
    const two = FR.createNet({ fetch: f404, config: cfg, local: l, session: ss, now: () => NOW + 60 * 1000 });
    await two.partners();
    ok('a database without official_partners() or news_report_significance(): each asked once, and the partners not again on the next page for half an hour', n404 === 2 && (await two.partners()).size === 0, n404);
    await FR.createNet({ fetch: f404, config: cfg, local: l, session: ss, now: () => NOW + 31 * 60 * 1000 }).partners();
    ok('...and asked again after that', n404 === 3, n404);
    const l2 = mem(), s2 = mem(); let asked = 0;
    const fOk = async (url, init) => { asked++; const ids = JSON.parse(init.body).p_article_ids; return { ok: true, status: 200, json: async () => ids.map(id => ({ article_id: id, game_id: 'g', points: 20, reasons: ['x'] })) }; };
    const rp2 = report({ h: 2 });
    await FR.createNet({ fetch: fOk, config: cfg, local: l2, session: s2, now: () => NOW }).significance([rp2]);
    const again = await FR.createNet({ fetch: fOk, config: cfg, local: l2, session: s2, now: () => NOW + 1000 }).significance([rp2]);
    ok('what a tab was told about a match report\'s game is kept for the tab: the next page does not ask again', asked === 1 && again[rp2.id] && again[rp2.id].points === 20, [asked, again]);
  }
  const noApi = FR.createNet({ fetch: undefined, config: {}, local: null, now: () => NOW });
  ok('with no configuration at all it answers empty, never throws', (await noApi.partners()).size === 0 && (await noApi.significance(pool)) && Object.keys(await noApi.significance(pool)).length === 0);
}

console.log('\nthe page wiring (a fake window)');
{
  const listeners = {}, docL = {};
  const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; };
  const win = (path, search, extra) => Object.assign({
    location: { pathname: path, search: search || '' }, __CS_LEAGUE_SLUG: '',
    document: { visibilityState: 'visible', addEventListener: (t, f) => { docL[t] = f; }, removeEventListener() {} },
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); }, setInterval: () => 1, clearInterval() {}
  }, extra || {});
  let t = NOW;
  const store = FR.createStore({ local: mem(), session: mem(), now: () => t });
  const w = win('/epinoia/game/', '?g=abc', { __CS_LEAGUE_SLUG: 'nbl' });
  const h = FR.watchDwell(w, { store, now: () => t });
  ok('a league\'s page: it starts watching', !!h && !!h.tracker && ['pointerdown', 'keydown', 'scroll', 'wheel', 'touchstart'].every(e => listeners[e]));
  t += 5000; listeners.pointerdown.forEach(f => f()); h.tracker.tick();
  docL.visibilitychange && (w.document.visibilityState = 'hidden', docL.visibilitychange());
  ok('...and hiding the tab hands the dwell over: a few seconds of NBL on the device', store.profile().l.nbl && store.profile().l.nbl[0] > 0, store.profile());
  ok('the platform\'s pages (HOME) are nobody\'s league: nothing is watched', FR.watchDwell(win('/epinoia/home/', ''), { store }) === null);
  store.setEnabled(false);
  ok('switched off: nothing is watched at all', FR.watchDwell(win('/epinoia/t/', '?l=nbl'), { store }) === null);
  store.setEnabled(true);
  const w2 = win('/epinoia/p/', '?l=kbl');
  ok('a page that names its league in its address counts for it (?l=)', !!FR.watchDwell(w2, { store }));
  const w3 = win('/epinoia/news/', '');
  ok('the News page with no league is nobody\'s: watched, but counts for no league', (() => { const hh = FR.watchDwell(w3, { store, now: () => t }); if (!hh) return false; t += 5000; listeners.keydown.forEach(f => f()); hh.tracker.tick(); return Object.keys(hh.tracker.pending()).length === 0; })());
  const before = JSON.stringify(store.profile().l);
  (listeners['epinoia:follows'] || []).forEach(f => f({ detail: { kind: 'team', id: 'x', on: true } }));
  ok('a club or league followed on a league\'s page is a reason to like the league: FOLLOW_LEAGUE_PTS on this device', JSON.stringify(store.profile().l) !== before);
  ok('no document (a service worker, a test): nothing, no throw', FR.watchDwell({ location: { pathname: '/epinoia/game/' } }, { store }) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
