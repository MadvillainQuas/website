// THE PAYMENT WINDOW (epinoia/paywindow.js, the hook in access.js, the pages' CSP), with no browser. What is held here:
//   * the wording each box shows is the billing function's, word for word, under the version checkout is sent;
//   * a fan's trial is the database's answer for them, else the plan's; the summary and the button say it;
//   * the league's own plans come first, the ones on sale before the rest;
//   * the way back is this page, less what a return from Stripe added; a league's slug comes from the join link;
//   * a membership has landed: a new subscription, or every feature the plan sells;
//   * access.js opens the window on a membership button, never on the join page, an embed or in the app, and the
//     click goes to the join page when the window cannot load; it reopens after sign-in and after a reload;
//   * every page that can open it lets Stripe's embedded Checkout run (its CSP), and no admin page or embed does.
//
//   node supabase/tests/paywindow.test.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const P = createRequire(import.meta.url)(path.join(ROOT, 'epinoia', 'paywindow.js'));
const B = await import(pathToFileURL(path.join(ROOT, 'supabase', 'functions', '_shared', 'billing.js')).href);
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw))); } };

console.log('\nthe words a fan agrees to');
ok('the pay-now box is the billing function\'s wording, under its version', P.NOW_WORDING === B.CONSENT[P.NOW_VERSION] && P.NOW_VERSION === '2026-09-a');
ok('the free-trial box is the trial wording, under the trial version', P.TRIAL_WORDING === B.CONSENT[P.TRIAL_VERSION] && P.TRIAL_VERSION === B.TRIAL_CONSENT);
ok('the age box is the billing function\'s', P.ADULT_WORDING === B.ADULT_WORDING);

console.log('\nwhat is offered');
const plan = { id: 'p1', league_id: null, price_pennies: 499, currency: 'gbp', interval: 'month', trial_months: 3 };
ok('the trial is the database\'s answer for this fan, else the plan\'s own', P.trialOf(plan, { p1: 0 }) === 0 && P.trialOf(plan, null) === 3 && P.trialOf(plan, { p1: 2 }) === 2 &&
   P.trialOf({ id: 'x', trial_months: 40 }, null) === 0);
const now = new Date(2026, 9, 2, 12);
const t = P.summary(plan, 3, now), n = P.summary(plan, 0, now);
ok('a trial: months free, the price after, nothing today, the first payment\'s day, the trial wording and button',
   t.price === '3 months free, then £4.99 a month, including any VAT. Nothing is charged today.' && /^From 2 January 2027 it renews automatically every month at £4\.99/.test(t.renew) &&
   t.button === 'Start my free trial' && t.version === '2026-10-t' && t.wording === P.TRIAL_WORDING, t);
ok('no trial: the price, the renewal, pay-now wording, a button that says what it costs',
   n.price === '£4.99 a month, including any VAT.' && n.button === 'Pay £4.99 a month and join' && n.version === '2026-09-a', n);
ok('a month from 31 January is the last of February (as the billing function counts it)', P.trialEndWords(1, new Date(2026, 0, 31)) === '28 February 2026');
const o = P.ordered([{ id: 'a', league_id: null }, { id: 'b', league_id: 'L', purchasable: false }, { id: 'c', league_id: 'L' }, { id: 'd', league_id: null, purchasable: false }]);
ok('the league\'s own plans first, those on sale before the rest', o.map(x => x.id).join('') === 'cbad', o.map(x => x.id));

console.log('\nthe way back');
ok('this page, less what a return from Stripe added', P.hereFor({ pathname: '/epinoia/t/', search: '?t=abc&joined=1&session_id=cs_1' }) === '/epinoia/t/?t=abc' &&
   P.hereFor({ pathname: '/epinoia/l/', search: '' }) === '/epinoia/l/');
ok('...and the league from the join link the button carried', P.slugOf('/epinoia/join/?l=nbl&next=%2Fepinoia%2Ft%2F') === 'nbl' && P.slugOf('/epinoia/join/') === '');
ok('it has landed: a new subscription', P.landed({ known: true, subscriptions: 1, features: [] }, { subsBefore: 0, features: ['analytics'] }));
ok('...or every feature the plan sells (a grant held before is not enough on its own)', P.landed({ known: true, subscriptions: 2, features: ['club_report'] }, { subsBefore: 2, features: ['club_report'] }) &&
   !P.landed({ known: true, subscriptions: 2, features: [] }, { subsBefore: 2, features: ['club_report'] }) && !P.landed({ known: false }, { subsBefore: 0 }));
ok('money as the fan reads it', P.money(499, 'gbp') === '£4.99' && P.money(5000, 'eur') === '€50.00');

console.log('\nthe hook (access.js)');
{
  const acc = readFileSync(path.join(ROOT, 'epinoia', 'access.js'), 'utf8');
  const pw = readFileSync(path.join(ROOT, 'epinoia', 'paywindow.js'), 'utf8');
  ok('a membership button opens the window instead of leaving the page', /closest\('a\.ep-lock-go, a\.mem-tip-go, a\[data-paywindow\]'\)/.test(acc) && /e\.preventDefault\(\);/.test(acc));
  ok('...a modified click, the join page, an embed and the app are left alone', /e\.button !== 0 \|\| e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.altKey/.test(acc) &&
     /\\\/epinoia\\\/\(join\|embed\)\\\//.test(acc) && /m-ios-app/.test(acc));
  ok('...and when the window cannot load, the click goes on to the join page', /P\.open\(\{ href, key: a\.getAttribute\('data-lock'\) \|\| null \}\), \(\) => \{ location\.assign\(href\); \}/.test(acc));
  ok('loaded from beside access.js, with its stamp', acc.includes("s.replace(/access\\.js(\\?|$)/, 'paywindow.js$1')"));
  ok('it reopens after signing in for a plan (#epjoin=<plan>.<league>), back from Stripe, or after the page reloaded itself',
     /#epjoin=\(\[0-9a-f-\]\{36\}\)/.test(acc) && /joined=1/.test(acc) && /pending\.confirming && Date\.now\(\) - \(pending\.at \|\| 0\) < 600000/.test(acc));
  const pf = readFileSync(path.join(ROOT, 'epinoia', 'payframe.js'), 'utf8');
  ok('the window pays inside the page through the payment frame when it has a key and may frame its own site, else on Stripe\'s own page',
     /const embedded = !!ctx\.pk && framesSelf\(\);/.test(pw) && /f\.setAttribute\('allow', 'payment \*'\)/.test(pw) && /root\.location\.assign\(again\.data\.url\)/.test(pw) &&
     /if \(!ready && W && f\.isConnected\) \{ stop\(\); hosted\(\); \}/.test(pw));
  ok('...the checkout goes to that frame alone, by message, never in its address', /e\.origin !== root\.location\.origin \|\| e\.source !== f\.contentWindow/.test(pw) &&
     /f\.contentWindow\.postMessage\(\{ type: 'epinoia:pay', pk: ctx\.pk, cs: res\.data\.client_secret/.test(pw) && !/cs=|client_secret=/.test(pw));
  ok('the frame takes it only from a window of this site, mounts embedded Checkout, and says when it is paid or cannot start',
     /e\.origin !== ORIGIN \|\| e\.source !== window\.parent/.test(pf) && /initEmbeddedCheckout\(\{ fetchClientSecret: \(\) => Promise\.resolve\(d\.cs\), onComplete:/.test(pf) &&
     /type: 'epinoia:paid'/.test(pf) && /type: 'epinoia:payframe-error'/.test(pf));
  ok('...a league\'s own plan runs Stripe.js on the league\'s account', /Stripe\(d\.pk, d\.account \? \{ stripeAccount: String\(d\.account\) \} : undefined\)/.test(pf));
  ok('the confirmation is kept until the fan closes it, so a page that reloads itself does not lose it', /p\.done = ok;/.test(pw) && /W\.onShut = \(\) => \{ try \{ root\.sessionStorage\.removeItem\(PENDING_KEY\)/.test(pw));
  ok('both boxes must be ticked, said in words', /'Tick both boxes to continue\.'/.test(pw) && /form\.noValidate = true/.test(pw));
}

console.log('\nthe pages\' CSP');
{
  ok('a page may frame its own site: frame-src, else child-src, else default-src, else anything',
     P.framesSelfFrom("default-src 'self'; script-src 'self'") && P.framesSelfFrom(null) && P.framesSelfFrom("frame-src 'self' https://www.youtube.com") &&
     !P.framesSelfFrom("default-src 'self'; frame-src https://www.google.com https://discord.com") && P.framesSelfFrom("default-src 'none'; frame-src *"));
  const pages = [];
  const walk = d => readdirSync(d).forEach(f => { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.html')) pages.push(p); });
  walk(path.join(ROOT, 'epinoia'));
  const cspOf = html => (/<meta http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html) || [])[1] || null;
  const rel = p => path.relative(path.join(ROOT, 'epinoia'), p);
  const stripe = pages.filter(p => /stripe\.com/.test(cspOf(readFileSync(p, 'utf8')) || '')).map(rel);
  ok('the payment frame is the one page that admits Stripe; every other page keeps its own CSP', JSON.stringify(stripe) === '["payframe.html"]', stripe);
  const fr = readFileSync(path.join(ROOT, 'epinoia', 'payframe.html'), 'utf8'), c = cspOf(fr);
  ok('...Stripe.js, its frames and its API, nothing inline', /script-src 'self' https:\/\/js\.stripe\.com;/.test(c) && /frame-src https:\/\/js\.stripe\.com https:\/\/hooks\.stripe\.com https:\/\/checkout\.stripe\.com;/.test(c) &&
     /connect-src 'self' https:\/\/api\.stripe\.com/.test(c) && !/unsafe-inline'[^;]*script|script-src[^;]*unsafe/.test(c) && /<script src="payframe\.js\?v=\d+"><\/script>/.test(fr));
  const can = pages.filter(p => { const h = readFileSync(p, 'utf8'); return h.includes('access.js') && !/^(admin|embed|join)\//.test(rel(p)); });
  const hosted = can.filter(p => !P.framesSelfFrom(cspOf(readFileSync(p, 'utf8')))).map(rel);
  ok('the pages that may not frame their own site pay on Stripe\'s own page instead (' + hosted.length + ' of ' + can.length + ')', can.length >= 20, hosted);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
