/* ============================================================================
   Epinoia cookie bridge — the browser hands the worker its YouTube sign-in.

   yt-dlp needs a signed-in YouTube session to download a game, and a session
   exported by hand goes stale the next time the browser rotates it. This
   extension watches the youtube.com cookies in THIS browser and, whenever they
   change (and every half hour regardless), writes them to the AI worker on this
   PC as a Netscape cookie file over http://127.0.0.1:47831 — the same file the
   worker would otherwise be given by hand. Nothing leaves the machine.

   Install once: edge://extensions → Developer mode → Load unpacked → this folder.
   ============================================================================ */
const WORKER = 'http://127.0.0.1:47831/cookies';
const DOMAINS = ['youtube.com'];
let timer = null;

function netscape(cookies) {
  const lines = ['# Netscape HTTP Cookie File', '# written by the Epinoia cookie bridge', ''];
  for (const c of cookies) {
    const dom = c.domain || '';
    const flag = dom.startsWith('.') ? 'TRUE' : 'FALSE';
    const exp = c.expirationDate ? Math.floor(c.expirationDate) : 0;
    lines.push([(c.httpOnly ? '#HttpOnly_' : '') + dom, flag, c.path || '/',
                c.secure ? 'TRUE' : 'FALSE', String(exp), c.name, c.value].join('\t'));
  }
  return lines.join('\n') + '\n';
}

async function send(reason) {
  let all = [];
  for (const d of DOMAINS) all = all.concat(await chrome.cookies.getAll({ domain: d }));
  const signed = all.some(c => c.name === 'SAPISID' || c.name === 'LOGIN_INFO');
  const body = netscape(all);
  try {
    const r = await fetch(WORKER, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body });
    const txt = await r.text();
    await chrome.storage.local.set({ last: { at: Date.now(), reason, cookies: all.length, signed, reply: txt.slice(0, 120) } });
    chrome.action.setBadgeText({ text: signed ? '' : '!' });
    chrome.action.setTitle({ title: 'Epinoia cookie bridge — ' + all.length + ' cookies sent ' + new Date().toLocaleTimeString() +
                             (signed ? '' : ' (NOT signed in to YouTube in this browser)') });
  } catch (e) {
    /* the worker is not running: nothing to do until it is; the alarm tries again */
    await chrome.storage.local.set({ last: { at: Date.now(), reason, cookies: all.length, signed, error: String(e) } });
    chrome.action.setBadgeText({ text: '…' });
    chrome.action.setTitle({ title: 'Epinoia cookie bridge — worker not reachable; will retry' });
  }
}
function soon(reason) {
  clearTimeout(timer);
  timer = setTimeout(() => send(reason), 20000);        // a burst of rotations becomes one send
}

chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create('tick', { periodInMinutes: 30 }); send('installed'); });
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create('tick', { periodInMinutes: 30 }); send('startup'); });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'tick') send('alarm'); });
chrome.cookies.onChanged.addListener(info => {
  const d = (info.cookie && info.cookie.domain) || '';
  if (DOMAINS.some(x => d.endsWith(x))) soon('changed');
});
chrome.action.onClicked.addListener(() => send('click'));
