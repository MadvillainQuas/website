/* THE PLATFORM CONSOLE'S MESSAGE IS A POP-UP (platform.js say(), the #msg rules in platform/index.html).
   It used to sit under the header and scroll itself into view, so saving something far down a long tab threw the
   page back to the top. It must never scroll the page, and it must go by itself.

   say() is run here over a small fake of the one element it drives, with the timers under this file's control;
   the real page was also driven in Chromium (scrolled to 2500px, a message, the scroll unchanged; desktop and phone).

     node supabase/tests/platform-toast.test.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'epinoia', 'admin', 'platform');
const js = readFileSync(path.join(root, 'platform.js'), 'utf8').replace(/\r\n/g, '\n');
const html = readFileSync(path.join(root, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + JSON.stringify(d) : '')); } };

const start = js.indexOf('let sayTimer = 0;');
const end = js.indexOf('\n}\n', js.indexOf('function say(', start)) + 3;
const src = js.slice(start, end);
ok('say() is found in platform.js', start > 0 && end > start, [start, end]);

console.log('\nthe source');
ok('it never scrolls the page: no scrollIntoView, scrollTo or focus inside say()', !/scrollIntoView|scrollTo|scrollTop|\.focus\(/.test(src), src.match(/scroll\w*|\.focus\(/g));
ok('an error is announced as an alert, the rest as a status', /kind === 'err' \? 'alert' : 'status'/.test(src));
ok('a "Saved" goes by itself, a refusal stays longer', /kind === 'err' \? 20000 : 5000/.test(src));
ok('#msg is fixed to the corner, above the phone\'s bottom bar, not in the flow', /#msg\.msg\{position:fixed/.test(html) && /@media \(max-width:820px\)\{#msg\.msg\{[^}]*bottom:calc\(64px/.test(html));
ok('...and stays hidden with .hide (the class say("") sets)', /\.hide\{display:none !important\}/.test(html));
ok('...and does not animate for people who ask for less motion', /prefers-reduced-motion:reduce\)\{#msg\.pop\{animation:none\}/.test(html));

console.log('\nsay()');
const timers = [];
let now = 0;
const fakeSetTimeout = (fn, ms) => { timers.push({ fn, at: now + ms, id: timers.length + 1, live: true }); return timers.length; };
const fakeClear = id => { if (timers[id - 1]) timers[id - 1].live = false; };
const advance = ms => { now += ms; for (const t of timers) if (t.live && t.at <= now) { t.live = false; t.fn(); } };

function node(tag) {
  const n = { tag, children: [], className: '', attrs: {}, cls: new Set(), text: '', hovered: false,
    classList: { add: c => { n.cls.add(c); n.className = n.className + ' ' + c; }, remove: c => n.cls.delete(c) },
    setAttribute(k, v) { n.attrs[k] = v; }, getAttribute(k) { return n.attrs[k]; },
    append(...c) { n.children.push(...c); }, addEventListener(t, f) { (n.l = n.l || {})[t] = f; },
    matches(q) { return q === ':hover' ? n.hovered : false; }, offsetWidth: 1 };
  Object.defineProperty(n, 'textContent', { get: () => n.text + n.children.map(c => c.textContent).join(''), set: v => { n.text = v; n.children = []; } });
  return n;
}
const msg = node('div');
const $ = () => msg;
const el = (t, c, x) => { const n = node(t); if (c) n.className = c; if (x != null) n.text = x; return n; };
const say = new Function('$', 'el', 'setTimeout', 'clearTimeout', src + '; return say;')($, el, fakeSetTimeout, fakeClear);
const shown = () => !/\bhide\b/.test(msg.className.replace(/\bpop\b/, ''));

say('Saved.', 'ok');
ok('a message shows its text and a close button', shown() && msg.children[0].text === 'Saved.' && msg.children[1].text === '×' && msg.children[1].attrs['aria-label'] === 'close', msg.children.map(c => c.text));
ok('...classed by its kind, popping in, as a status', /\bmsg ok\b/.test(msg.className) && msg.cls.has('pop') && msg.attrs.role === 'status', [msg.className, msg.attrs]);
advance(4900);
ok('...still there at 4.9 seconds', shown());
advance(200);
ok('...gone at five, by itself', !shown() && msg.children.length === 0);

say('Refused: permission denied [42501]', 'err');
ok('an error is an alert', msg.attrs.role === 'alert' && /\bmsg err\b/.test(msg.className));
advance(19000);
ok('...it is still there at 19 seconds', shown());
advance(1500);
ok('...and gone at twenty', !shown());

say('One', 'ok');
say('Two', 'ok');
ok('a new message replaces the one showing, not stacks', msg.children.length === 2 && msg.children[0].text === 'Two');
advance(4000);
say('Three', 'ok');
advance(4000);
ok('...and the wait starts again for the new one (the old timer is cleared)', shown() && msg.children[0].text === 'Three');
advance(1500);
ok('...then it goes', !shown());

say('Held', 'ok');
msg.hovered = true;
msg.onmouseenter();
advance(60000);
ok('the pointer over it holds it', shown());
msg.hovered = false;
msg.onmouseleave();
advance(5100);
ok('...and it goes a few seconds after the pointer leaves', !shown());

say('Again', 'ok');
msg.hovered = true;
say('Replaced while hovered', 'ok');
advance(60000);
ok('a message that arrives under the pointer waits for the pointer too', shown() && msg.children[0].text === 'Replaced while hovered');
msg.hovered = false; msg.onmouseleave(); advance(5100);

say('Focused', 'ok');
const x = msg.children[1];
msg.children[1].onfocus();
advance(60000);
ok('keyboard focus on the close button holds it', shown());
x.onblur();
advance(5100);
ok('...and releases it when focus leaves', !shown());

say('Close me', 'ok');
msg.children[1].l.click();
ok('the close button dismisses it at once', !shown() && msg.children.length === 0);
say('Cleared', 'ok'); say('');
ok('say("") clears it, whatever was showing', !shown());
advance(60000);
ok('...and no stale timer fires afterwards', !shown());

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
