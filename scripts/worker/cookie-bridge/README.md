# Epinoia cookie bridge

The AI worker downloads games with yt-dlp, which needs a signed-in YouTube session. A cookie
file exported by hand goes stale the next time the browser rotates the session; this extension
keeps it fresh automatically.

Install once, in Edge or Chrome:

1. Open `edge://extensions` (or `chrome://extensions`), switch on **Developer mode**.
2. **Load unpacked** → choose this folder (`scripts/worker/cookie-bridge`).
3. Be signed in to YouTube in that browser. That is all.

Whenever the youtube.com cookies change — and every half hour regardless — the extension
posts them to the worker at `http://127.0.0.1:47831/cookies`, and the worker writes them to
its `yt_cookies_file`. Click the extension's icon to send them right now. A `!` badge means
the browser is not signed in to YouTube; `…` means the worker is not running yet (it retries).
Nothing leaves the PC. Set `cookie_bridge_port` to 0 in `worker.json` to switch it off.
