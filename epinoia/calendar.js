'use strict';
/* ============================================================================
   Calendar — "add these fixtures to your calendar", in the way the phone or computer
   in hand actually does it (docs/calendar.md).

   ONE FEED, FOUR ROUTES. The ics Edge Function serves a club's or a league's fixtures
   at a URL that never changes. What differs is how a calendar takes it:

     Apple Calendar        opens a webcal: link and subscribes. Updates itself.
     ICSx⁵ (Android)       subscribes on the phone and writes the events into Android's
                           own calendar, so SAMSUNG CALENDAR and every other Android
                           calendar app show them, and keep showing new ones.
     Google Calendar       "From URL" on the website. Google fetches the feed on its
                           servers, so it appears in Google Calendar on the web and in
                           the Google Calendar app — BUT NOT in Samsung Calendar or any
                           other app on the phone, which only see calendars that live in
                           the Google account itself. That is Google's limitation, not
                           the feed's, and it is why the Android route above exists.
     Outlook               "Subscribe from web", the same URL.

   AND, FOR ANY APP THAT CANNOT FOLLOW A LINK AT ALL (Samsung Calendar on its own, the
   stock Android calendar, an import into anything): the same feed as a file to save and
   open. That is a snapshot — it does not update — and the panel says so, because a
   calendar that has quietly stopped updating is worse than one that was never added.

   The panel is plain DOM, drawn once, with its own stylesheet injected once. It has no
   dependencies, so any page can call:

     EpinoiaCalendar.mount(host, { url, name })     url: the .ics feed, absolute
                                                    name: what is being followed
   UMD so supabase/tests/ics.test.mjs can require() it under Node with a fake document.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaCalendar = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const GOOGLE_ADD = 'https://calendar.google.com/calendar/r/settings/addbyurl';
const OUTLOOK_ADD = 'https://outlook.live.com/calendar/0/addfromweb';
/* ICSx⁵ is the Android app that turns a feed into a real calendar on the phone: open
   source (GPL), no account, no advertising.

   THE LINK IS F-DROID, NOT PLAY, AND THAT IS THE WHOLE POINT. The app is the same
   either way, but its Play listing is £1.79 — the developer charges there and gives it
   away on F-Droid, which is their business and not something this panel should pass on
   to a supporter who only wants their club's fixtures. The words in the panel name the
   Play price rather than hiding it, so anybody who would rather pay the developer knows
   where to go — and anybody who will not install F-Droid is pointed at Google Calendar,
   which is free and needs no app at all. */
const ICSX5 = 'https://f-droid.org/packages/at.bitfire.icsdroid/';

const g = k => root[k];

/* which set of steps to put first */
function platform(nav) {
  const n = nav || g('navigator') || {};
  const ua = String(n.userAgent || '');
  if (/iPhone|iPad|iPod/i.test(ua) || (n.platform === 'MacIntel' && (n.maxTouchPoints || 0) > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
  return 'desktop';
}

const webcalOf = url => String(url || '').replace(/^https:/i, 'webcal:');
const downloadOf = url => String(url || '') + (String(url || '').includes('?') ? '&' : '?') + 'download=1';

/* The routes, in the order this device should see them. Each: what it is called, what it
   does, the button and the words under it. */
function routes(plat, url, name) {
  const webcal = webcalOf(url);
  const file = {
    id: 'file',
    title: 'Any other calendar app',
    how: 'Download the fixtures as a file and open it in your calendar app. This is a snapshot: it does not update by itself, so add it again after fixtures move.',
    action: { label: 'Download the file', href: downloadOf(url), download: true }
  };
  const apple = {
    id: 'apple',
    title: plat === 'ios' ? 'iPhone or iPad' : 'Apple Calendar',
    how: plat === 'ios'
      ? 'Tap Subscribe, then Subscribe again when iOS asks, and choose the account to put it in. It updates itself.'
      : 'Opens Calendar and asks you to subscribe. It updates itself.',
    action: { label: 'Subscribe in Apple Calendar', href: webcal }
  };
  const android = {
    id: 'android',
    title: 'Android, including Samsung Calendar',
    how: 'Samsung Calendar and the other Android calendar apps cannot follow a calendar link on their own. ICSx⁵ does it for them: install it, tap Subscribe below, and the fixtures appear in Samsung Calendar and keep updating. Get it free from F‑Droid — the same app costs £1.79 on Google Play, which is the developer asking to be paid rather than anything this feed needs. If you would rather not install F‑Droid, Google Calendar below is free and needs no app at all.',
    action: { label: 'Subscribe on this phone', href: webcal },
    extra: { label: 'Get ICSx⁵ free (F‑Droid)', href: ICSX5 }
  };
  const google = {
    id: 'google',
    title: 'Google Calendar',
    how: 'Copy the address, then paste it into “URL of calendar” and press Add calendar. Added this way it shows in Google Calendar on the web and in the Google Calendar app — but not in Samsung Calendar or other phone calendar apps. For those, use the Android steps.',
    action: { label: 'Copy address and open Google', href: GOOGLE_ADD, copy: true }
  };
  const outlook = {
    id: 'outlook',
    title: 'Outlook',
    how: 'Opens Outlook’s Subscribe from web. If the address box is empty, paste the address below into it and press Import.',
    action: { label: 'Subscribe in Outlook', href: OUTLOOK_ADD + '?url=' + encodeURIComponent(url) + '&name=' + encodeURIComponent(name || 'Fixtures'), copy: true }
  };
  if (plat === 'ios') return [apple, google, outlook, file];
  if (plat === 'android') return [android, file, google, outlook];
  if (plat === 'mac') return [apple, google, outlook, file];
  return [google, outlook, apple, file];
}

/* the chip's own glyph: a calendar, drawn in the line's colour like the follow bell's */
const CAL_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>' +
  '<rect x="7" y="13" width="4" height="4" rx="1" fill="currentColor" stroke="none"/></svg>';

const CSS = [
  /* THE CHIP IS THE FOLLOW BELL'S SIBLING (epinoia-kit.css .ep-follow): the same 30px pill, the
     same micro capitals, the same hover, and filled with the accent while the panel is open.
     A plain .ep-chip button next to it came out as a white rectangle in the browser's own font. */
  '.ep-cal-chip{display:inline-grid;grid-auto-flow:column;align-items:center;gap:7px;height:30px;',
  'padding:0 13px 0 10px;border-radius:15px;border:1px solid var(--rule-2);background:transparent;',
  'color:var(--ink-3);cursor:pointer;vertical-align:middle;line-height:1;',
  'font-family:var(--f-micro);font-size:8px;letter-spacing:.12em;text-transform:uppercase;transition:.2s}',
  '.ep-cal-chip svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}',
  '.ep-cal-chip:hover{color:var(--lume);border-color:var(--lume)}',
  '.ep-cal-chip:focus-visible{outline:2px solid var(--lume);outline-offset:2px}',
  '.ep-cal-chip.on{background:var(--lume);border-color:var(--lume);color:var(--on-accent,var(--ground))}',
  '.ep-cal{flex-basis:100%;max-width:620px;margin-top:4px;border:1px solid var(--rule-2);border-top:2px solid var(--lume);background:var(--panel)}',
  '.ep-cal[hidden]{display:none}',
  '.ep-cal-h{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:11px 13px;border-bottom:1px solid var(--rule)}',
  '.ep-cal-h b{font-family:var(--f-ui);font-weight:700;font-size:14px;color:var(--ink)}',
  '.ep-cal-x{-webkit-appearance:none;appearance:none;border:0;background:none;cursor:pointer;font:inherit;font-size:16px;line-height:1;color:var(--ink-3);padding:2px 4px}',
  '.ep-cal-x:hover{color:var(--ink)}',
  '.ep-cal-r{padding:11px 13px;border-bottom:1px solid var(--rule);display:grid;gap:7px}',
  '.ep-cal-r:last-of-type{border-bottom:0}',
  '.ep-cal-t{font-family:var(--f-micro);font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--lume)}',
  '.ep-cal-p{margin:0;font-size:13.5px;line-height:1.6;color:var(--ink-2)}',
  '.ep-cal-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
  '.ep-cal-go{display:inline-flex;align-items:center;min-height:38px;padding:0 14px;text-decoration:none;',
  'font-family:var(--f-micro);font-size:10px;letter-spacing:.1em;text-transform:uppercase;',
  'background:var(--lume);color:var(--on-accent);border:1px solid var(--lume)}',
  '.ep-cal-go.ghost{background:transparent;color:var(--ink);border-color:var(--rule-2)}',
  '.ep-cal-go:focus-visible{outline:2px solid var(--lume);outline-offset:2px}',
  '.ep-cal-f{padding:11px 13px;display:grid;gap:6px;background:var(--panel-2,transparent)}',
  /* the kit caps .ep-input at 260px, which cuts the address in half on a desktop */
  '.ep-cal-url{width:100%;max-width:none;font-family:var(--f-data);font-size:11px}',
  /* justify-self, not align-self: in a grid the button would otherwise stretch the row\'s width */
  '.ep-cal-copy{justify-self:start}',
  '.ep-cal-note{font-family:var(--f-micro);font-size:9px;letter-spacing:.04em;line-height:1.9;color:var(--ink-3)}',
  '.ep-cal-msg{font-size:12.5px;line-height:1.6;color:var(--lume);min-height:1em}'
].join('');

function styles(doc) {
  if (doc.getElementById('ep-cal-css')) return;
  const s = doc.createElement('style');
  s.id = 'ep-cal-css';
  s.textContent = CSS;
  (doc.head || doc.documentElement).appendChild(s);
}

/* Put the address on the clipboard, and say whether it worked: an iPhone in a private
   window, an old browser, or a page without permission all fail, and then the address is
   there in the field to copy by hand. */
function copyText(text, nav) {
  const n = nav || g('navigator');
  try {
    if (n && n.clipboard && n.clipboard.writeText) return n.clipboard.writeText(text).then(() => true, () => false);
  } catch (_) { /* below */ }
  return Promise.resolve(false);
}

function mount(host, opts) {
  const o = opts || {};
  const doc = o.document || g('document');
  if (!doc || !host || !o.url) return null;
  styles(doc);
  const el = (t, c, x) => { const n = doc.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const name = o.name || 'these fixtures';
  const nav = o.navigator || g('navigator');
  const plat = o.platform || platform(nav);

  const chip = el('button', 'ep-cal-chip');
  chip.type = 'button';
  const icon = el('span', 'ep-cal-ic');
  try { icon.innerHTML = CAL_SVG; } catch (_) { /* a document that will not take markup: the words alone */ }
  chip.append(icon, el('span', null, 'add to calendar'));
  chip.setAttribute('aria-expanded', 'false');
  chip.title = 'subscribe to ' + name + ' in your calendar';

  const panel = el('div', 'ep-cal');
  panel.hidden = true;
  panel.setAttribute('role', 'group');

  const head = el('div', 'ep-cal-h');
  head.append(el('b', null, name + ' in your calendar'));
  const close = el('button', 'ep-cal-x', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'close');
  head.appendChild(close);
  panel.appendChild(head);

  const msg = el('div', 'ep-cal-msg');
  msg.setAttribute('role', 'status');

  const field = doc.createElement('input');
  field.type = 'text';
  field.readOnly = true;
  field.value = o.url;
  field.className = 'ep-input ep-cal-url';
  field.setAttribute('aria-label', 'calendar address for ' + name);
  field.addEventListener('focus', () => { try { field.select(); } catch (_) { /* older browser */ } });

  routes(plat, o.url, name).forEach(r => {
    const row = el('div', 'ep-cal-r');
    row.dataset.route = r.id;
    row.append(el('div', 'ep-cal-t', r.title), el('p', 'ep-cal-p', r.how));
    const acts = el('div', 'ep-cal-acts');
    const a = el('a', 'ep-cal-go', r.action.label);
    a.href = r.action.href;
    if (r.action.download) a.setAttribute('download', '');
    else { a.target = '_blank'; a.rel = 'noopener'; }
    /* the copy happens on the click itself, so the browser counts it as a gesture; the new
       tab opens from the same click, so no popup blocker stops it */
    if (r.action.copy) {
      a.addEventListener('click', () => {
        copyText(o.url, nav).then(ok => {
          msg.textContent = ok
            ? 'Address copied. Paste it into the box on the page that just opened.'
            : 'Copy the address below, then paste it into the box on the page that just opened.';
          try { if (!ok) field.focus(); } catch (_) { /* nothing to focus */ }
        });
      });
    }
    acts.appendChild(a);
    if (r.extra) {
      const b = el('a', 'ep-cal-go ghost', r.extra.label);
      b.href = r.extra.href; b.target = '_blank'; b.rel = 'noopener';
      acts.appendChild(b);
    }
    row.appendChild(acts);
    panel.appendChild(row);
  });

  const foot = el('div', 'ep-cal-f');
  const copy = el('button', 'ep-cal-go ghost ep-cal-copy', 'copy address');
  copy.type = 'button';
  copy.addEventListener('click', () => {
    copyText(o.url, nav).then(ok => {
      msg.textContent = ok ? 'Address copied.' : 'Select the address below and copy it.';
      try { if (!ok) field.focus(); } catch (_) { /* nothing to focus */ }
    });
  });
  foot.append(field, copy, msg,
    el('div', 'ep-cal-note', 'Subscribed calendars update themselves: a moved tip-off, a new round or a final score arrives without doing anything. Apple and ICSx⁵ look every few hours; Google can take up to a day.'));
  panel.appendChild(foot);

  const show = on => {
    panel.hidden = !on;
    chip.setAttribute('aria-expanded', on ? 'true' : 'false');
    chip.className = 'ep-cal-chip' + (on ? ' on' : '');
    if (!on) msg.textContent = '';
  };
  chip.addEventListener('click', () => show(panel.hidden));
  close.addEventListener('click', () => { show(false); try { chip.focus(); } catch (_) { /* gone */ } });

  host.appendChild(chip);
  host.appendChild(panel);
  return { chip, panel, show: () => show(true), hide: () => show(false) };
}

return { mount, platform, webcalOf, downloadOf, routes, GOOGLE_ADD, OUTLOOK_ADD, ICSX5, CSS };
}));
