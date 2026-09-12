<!-- Written 2026-09-12 from a five-lane survey with an adversarial review. The CloudFront
     max-age this marks UNCONFIRMED for live games was confirmed the same evening: four live
     BCB games all returned max-age=30 (see docs/feed-timing.md). -->

# Real-time scoring over Bluetooth, USB or anything else: recommendation

## 1. The honest answer

**In principle, yes, but mostly not in the way the question assumes.**
- **In a browser:**
  - Android Chrome can read a serial device over Bluetooth Classic (SPP) since Chrome 138 ([release notes](https://developer.chrome.com/release-notes/138), [MDN BCD](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Serial.json)).
  - It can also read a USB serial adapter through WebUSB, but only adapters that present as standard CDC-ACM. The polyfill has no FTDI, CP2102 or CH340 support ([polyfill source](https://raw.githubusercontent.com/google/web-serial-polyfill/main/serial.ts)).
  - iOS cannot do any of this in any browser, and WebKit has said it won't ([webkit.org](https://webkit.org/tracking-prevention/)).
- **Needs a native bridge:** FIBA LiveStats has an in-arena TV feed that pushes every action with a UTC time of day. It is a raw TCP socket on port 7677 ([Genius docs](https://developer.geniussports.com/livestats/tvfeed/index_basketball.html)), and browsers can't open raw TCP outside Chrome Isolated Web Apps ([Chrome docs](https://developer.chrome.com/docs/iwa/direct-sockets)). So it needs a small native program (Python or Node) on a Pi or laptop.
- **Needs extra hardware:** any tap on the scoreboard console. That means an adapter plus a protocol per brand, and for Stramatel and Favero, the brands UK halls actually have, the protocols are unpublished.

**For you, this season:**
- **Fed games (LiveStats):** no Bluetooth, USB or console link can help. You have nobody and nothing in the hall. The delay is created by your own poller on a GitHub runner. The fix is server code, costs £0 and can ship this season.
- **Games scored in the Epinoia app:** the score already leaves the phone on the tap. The first event of a burst is sent immediately (live.js:574), and the 5 s heartbeat only fires after 5 s of silence (live.js:554). A Bluetooth or USB link carries data *into* the phone and doesn't touch the phone-to-Supabase hop. The only thing that takes hall wifi out of the picture is a different uplink, meaning cellular: about £60 plus about £5 a month, possible this season.
- **Console taps:** not this season, except possibly at one home venue whose console turns out to have a readable output. Even then they fix the hand-kept clock, not the score's latency.

## 2. What the real problem is

**Fed games: the poll dominates.**
- **The poller is the biggest delay.** Every live game is polled one after another in a single loop (run_ingest.py:1091-1138). Across four simultaneous live games on 2026-09-12: median 37.9 s between polls of the same game, worst 198.5 s, against 10.5 s claimed.
- **Timing depends on the poll.** The feed carries no time of day, so an action's timestamp is when you polled it. A slow poll makes the scores late *and* stamps plays wrong. video.js uses `wall_err` as run-up when it cuts clips, so a play can land in front of its own clip window.
- **The CDN sets a floor.** data.json comes through CloudFront with `Cache-Control: max-age=30`, and a cache-busting query string doesn't get past it (measured today on game 2702560). That game was *finished*, so max-age during a live game is UNCONFIRMED. If 30 s holds, perfect polling still returns copies up to 30 s old, and the adapter ignores the `Age` header, so stamps are late by that much as well.
- **Approximate staleness a viewer sees:**
  - LiveStats upload interval: undocumented, UNCONFIRMED.
  - CDN age: 0 to 30 s, UNCONFIRMED live.
  - Wait for the next poll: today about 19 s or more on average, because the gaps are long and uneven. About 5 s at a true 10 s cadence.
  - Rough totals: about 35 s or more today, about 20 s after the fix. Treat **15 to 30 s as the realistic floor of the public feed** until max-age on a live game is measured.
- **The host adds failure modes:**
  - A mid-game pass handover left a 49 s gap today.
  - A failed self-dispatch prints "dispatch failed" and exits 0 (ingest.yml:99).
  - GitHub says scheduled runs "can be delayed" and queued jobs "may be dropped" under load ([GitHub docs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)).
- **Where the internet dependency sits:** the league's LiveStats laptop, uploading over the venue's internet. Faster polling can't beat that uplink. If it drops, faster polling only confirms the feed is stale. Whether LiveStats buffers offline and back-fills is UNCONFIRMED.

**Scored games: wifi only matters for remote viewers.**
- **What is already offline-first:** scoring, the clock, the event log and finalising are all local. The game lives in localStorage, a service worker serves the app shell offline, and healDurable repairs the server copy once a minute.
- **What depends on the network:** only the phone-to-Supabase hop, which is what remote viewers see.
- **What is actually broken during an outage:**
  - The backlog is uncapped (live.js:477). On reconnect it replays the outage's clock frames on air: about 20 stale frames for a 60 s dropout (docs/outstanding.md item 43).
  - The backlog is in memory only, so a reload during an outage loses it.

**Where the dependency moves rather than disappears.** Nothing on your list removes the need for an internet hop to reach viewers and the database. Every option moves it:

| Option | Where the internet hop ends up |
|---|---|
| Cellular (MiFi or SIM) | From hall wifi to a mobile carrier. This is the only real improvement. |
| Relay box on the table | To the relay's own uplink, which in practice means the MiFi anyway |
| Sportzcast cloud | To a vendor box on the same venue network |
| LiveStats TV-feed bridge | To the bridge's uplink. It matters less here, because `timeActual` keeps the timing right even when the upload is late. |
| Console tap into the phone | Nowhere. It is an input link, and the phone still publishes over the same wifi. |

**One thing to ask the owner:** does the pain come from the **score** (lag on the public page), the **clock** (the statistician's hand-kept `S.clockMs` stamps every event, and nobody reconciles it with the board), or **fed-game lag**? A console link answers only the clock question.

## 3. The options, ranked

"Server" means your ingest code. "Browser" means the existing web app. "Native" means a separate program. "HW" means extra hardware.

| # | Option | Applies to | Where it runs | Needs | Cost | What it buys | What kills it |
|---|---|---|---|---|---|---|---|
| 1 | Poll games concurrently with a per-game deadline; overlapping pass handovers; a failed dispatch fails the job | Fed | Server | Code in run_ingest.py and ingest.yml | £0, 1–3 days | Median gap from 37.9 s to about 10 s; no silent chain death | CDN max-age (30 s on a finished game, live UNCONFIRMED); the LiveStats laptop's uplink; Genius throttling of concurrent ~10 s polls (UNCONFIRMED) |
| 2 | Stamp events at `t_obs − Age` and add `Age` to `wall_err` | Fed | Server | Keep the response headers in fiba_livestats.py:218 | £0, hours | Honest timestamps and clip run-up. No latency gain. | Nothing |
| 3 | Coalesce the backlog (item 43), make it durable (IndexedDB), and turn the whole header a different colour while events are unpublished | Scored | Browser | Code in live.js and sync.js | £0, hours plus 2–3 days | Outages become harmless: no fast-forward replay, nothing lost on reload | Nothing on the hall side |
| 4 | Battery 4G MiFi (TP-Link M7350) with a data SIM | Scored | HW, no code | Charged the night before, a SIM on an auto-renewing plan, the hall SSID forgotten on the scoring phone | £55–64 plus about £5/month ([TP-Link](https://www.tp-link.com/uk/home-networking/mifi/m7350/)) | Swaps hall wifi for cellular, for the scorer and clock cam together | Signal at the table in steel or concrete halls (unmeasured); the 2100 mAh battery, "up to 8 hours"; the phone auto-joining hall wifi (UNCONFIRMED). Does nothing for fed games. |
| 5 | Move the live lane to one always-on small host | Fed | Server | A VM or home box running the ingest loop | Cost not researched (UNCONFIRMED) | No mid-game handovers and no reliance on cron | One more thing to keep alive |
| 6 | LiveStats in-arena TV feed bridge (TCP 7677, `timeActual`) | Fed | Native, on the LiveStats laptop or a Pi on its LAN | Licence activation ("only via FLS7 License Code", [Genius support](https://sportingpulse.freshdesk.com/support/solutions/articles/9000176548-livestats-version-7-data-streaming)), league and operator cooperation, a scoped credential | £0 as a script on their laptop; about £15 as a Pi Zero 2 W | True action times and centisecond clocks; late uploads stop damaging timing | Third-party licence terms UNCONFIRMED; multiple clients UNCONFIRMED; needs someone's software at every fed venue |
| 7 | Board clock into `S.clockMs` over Web Serial RFCOMM with an SPP adapter | Scored, clock only | Browser (Android Chrome 138+) plus HW | A console with a readable spare output; the resumeClock/period split; crew-chief approval ([FIBA OBR Art. 46](https://assets.fiba.basketball/image/upload/documents-corporate-fiba-official-rules-2024-v10a.pdf)) | £25–60 plus weeks per console brand | The hall's real clock on every event in the permanent log. **Not** score latency. | Stramatel and Favero protocols unpublished; no disconnect events over Bluetooth on Android ([blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/BqUGCcurReE)); no iOS; the resumeClock period bug (score/index.html:2330) |
| 8 | Bodet Scorepad published protocol | Scored, clock | Native or HW | A Bodet venue with the output already enabled "by our technical staff"; ref 608264 downloaded | Under £100 | A documented feed | Byte layout never retrieved (UNCONFIRMED); off at most halls |
| 9 | Board feed into the control-room keeper | Broadcast clock | Browser (desktop Chrome/Edge 89+, [Chrome docs](https://developer.chrome.com/docs/capabilities/serial)) | Console output reachable from the PC; assert only on real transitions | Adapter about £10–20 | Clock on air only | Only a home broadcast venue has a control room |

**Dropped:**
- **Web Bluetooth:** a chooser tap on every reload in stock Chrome, and no iOS.
- **WebUSB with FTDI, CP2102 or CH340 adapters:** the polyfill can't drive them.
- **Bluefy, beacio or a native iOS app:** Bluefy runs in its own storage sandbox away from Safari; beacio needs iOS 26.2+ ([App Store](https://apps.apple.com/gb/app/ioswebble/id6761301368)); a native app risks App Store review guideline 4.2 ([guidelines](https://developer.apple.com/app-store/review/guidelines/)).
- **Sportzcast and ScoreBird:** US console brands only ([ScoreBird FAQ](https://scorebird.com/faq)), US support.
- **Ethernet run:** a cable across the floor.
- **LoRa:** 1% duty cycle.
- **Web NFC and WebHID:** NFC is a tap, not a stream; WebHID is desktop only.
- **SDR sniffing of the console radio:** risk under Wireless Telegraphy Act 2006 s.48 ([legislation.gov.uk](https://www.legislation.gov.uk/ukpga/2006/36/section/48)).
- **LAN-served relay:** blocked on iOS. It does work on Android Chrome 141+ for fetch and 147+ for WebSockets after a permission prompt ([blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/O6GMKt44Ups)), but it can't serve the public page.
- **Installing as a PWA "for the wake lock":** the scorer already holds one (bootstrap.js:1967-2019).

## 4. What I would do

Each stage is useful on its own. They are in order of cost.

**Stage 0 (today, £0): measure before promising anything.**
- Run `curl -sI` on a live game's data.json every 2 s for 10 minutes. Log `Cache-Control`, `Age` and `Last-Modified`. That gives the live max-age and how often LiveStats actually uploads.
- Ask the owner whether the complaint is fed-game lag, the scored-game score or the clock.

**Stage 1 (this week, £0, server): fix the fed-game poll.**
- Poll games concurrently with a per-game deadline.
- Start the next pass before the current one exits, and de-duplicate on the log's newest wall stamp.
- Make `gh workflow run` failures fail the job.
- Stamp events at `t_obs − Age` and add `Age` to `wall_err`.
- **Success test:** per-game poll gap p50 ≤ 12 s and p95 ≤ 20 s across four or more simultaneous games, and no gap over 60 s at a handover.

**Stage 2 (next week, £0, browser): harden scored games against outages.**
- Coalesce the backlog (item 43).
- Move the backlog to IndexedDB.
- Turn the whole header a different colour while events are unpublished.

**Stage 3 (about £60 plus £5/month): one MiFi.**
- First test signal at the scorer's table in the two or three halls that matter, using a phone's Personal Hotspot during a real game. Buy only if the signal holds.
- Then build a kit-bag checklist: charged, SIM on auto-renew, hall SSID forgotten on the scoring phone, a second carrier's SIM.

**Stage 4 (only if Stage 1 metrics still show handover or cron gaps): move the live lane to an always-on host.**

**Stage 5 (conditional on emails, not this season unless Genius says yes quickly): LiveStats TV-feed bridge.**
- Prototype as a script that runs *on the league's LiveStats laptop*. It reads localhost:7677 and posts actions with `timeActual` to your ingest endpoint using a narrowly scoped credential.
- The cloud poll stays as fallback and reconciliation.
- Build nothing until the licence question is answered. Ship Realtime Authorization first, because the open game channel is already proven.

**Stage 6 (separate project, not an answer to this question): hall clock into `S.clockMs`.**
- Only at a home venue, on one club-owned Android device, after photographing the console and getting written OK from the venue and its supplier.
- Split resumeClock from the period advance first. Take the period from the feed explicitly.
- Show a loud "BOARD FEED LOST, TAP THE CLOCK" state within seconds of silence.

## 5. What remains UNCONFIRMED, and how to settle each cheaply

| Unknown | Cheap way to settle it |
|---|---|
| CloudFront max-age and `Age` on a **live** game; how often LiveStats uploads | The Stage 0 curl loop during one live game (10 minutes) |
| Whether Genius throttles concurrent ~10 s per-game polling | Ramp from 1 to 4 concurrent live games at 10 s and watch for 403/429 and rising `Age`. Or ask Genius LiveStats support through the [freshdesk portal](https://sportingpulse.freshdesk.com/). |
| Whether LiveStats buffers offline and back-fills | Ask a league statistician. Or look in existing ingest logs for polls where many actions arrive at once after a stall. |
| Whether a third party can use the TV feed, whether several clients can connect, and whether localhost works | Email Genius LiveStats support and the league's stats coordinator: "Can Epinoia read the FLS7 Broadcast Feed on port 7677, alongside broadcast graphics?" |
| Why schedule runs appeared at 01:36Z and 07:52Z; how much pass start times drift | `gh run list --workflow ingest.yml --json createdAt,event`, and compare against the cron lines |
| Cellular signal at the scorer's table | Phone hotspot plus a speed test at the table during a game, in each key hall |
| Whether the scoring phone auto-joins hall wifi instead of the MiFi | 10-minute test on the actual phones with both networks remembered |
| Device mix of statisticians (iOS or Android) | Ask them, or record `navigator.userAgent` in game metadata |
| Which console each home hall has, and whether it has a spare output | Photograph the console's back and sides: Favero's second RJ-45, the Bodet output setting, or a Stramatel 452 radio unit with no cable to tap |
| Bodet basketball byte layout; whether enabling the output costs money | Download ref 608264; email Bodet UK or the venue's supplier (e.g. [Sportserve](https://sportserve.co.uk/collections/indoor-scoreboards)) |
| Whether the hall board's main digits show interval or time-out timers | Watch the board through one interval and one time-out at the home venue |
| Whether an open Serial or GATT link survives backgrounding on the actual tablet | 60-minute bench test: screen on, tab hidden, then check `document.wasDiscarded` (only if Stage 6 goes ahead) |
| Whether a USB adapter is CDC-ACM and not claimed by the Android kernel | Check the class code in `chrome://usb-internals` before buying in bulk (Stage 6 only) |
| Whether Chrome for Android now fires serial connect/disconnect events over Bluetooth | Test on the current Chrome (Stage 6 only) |
| Whether Sportzcast or ScoreBird support Stramatel, Bodet or Favero with UK service | Optional: one email each. Skip unless a hall turns out to have a US-brand console. |

---

## Corrections the review made to the survey

- Scope omission in every lane: all five lanes assume an Epinoia statistician in the hall and never consider FIBA LiveStats-fed games. For those games the latency comes from the serialised poller (median 37.9 s, worst 198.5 s, measured 2026-09-12). Source: C:/Users/Admin/Documents/website_repo/scripts/ingest/run_ingest.py:744-760 and 689-691. No in-hall transport affects it.
- Inconsistent Android Web Serial dates. The browser-apis lane cites MDN BCD Chrome Android 138 (RFCOMM only; confirmed at https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Serial.json) and says 'full Web Serial on Android lands in M149'. The scoreboard lane says Chrome 148 Beta added it. Chrome Platform Status lists 'Web Serial API on Android' at milestone 148, covering USB and Bluetooth serial (https://chromestatus.com/api/v0/features/6043992171085824). M149 does not match that entry, and 138 applies only to the RFCOMM-only BCD record.
- Other-routes lane cites the HSE PAT FAQ as support for 'venues routinely require PAT testing'. HSE says the opposite about the law: the regulations 'don't make inspection or testing of electrical appliances a legal requirement' (https://www.hse.gov.uk/electricity/faq-portable-appliance-testing.htm). The requirement is a venue hire condition, confirmed for Fife Leisure: 'Portable electrical equipment must be PAT tested with proof provided in advance' (https://www.fifeleisure.org.uk/venue-hire/). It is not universal.
- Other-routes lane says a LAN-served relay is 'Irrelevant while the scoring devices are iOS'. Nothing in the repo shows the scoring devices are iOS. The our-constraints lane explicitly says device type is unknown, and docs/outstanding.md:430 mentions an iPhone only as a hypothetical banner example. Treat device mix as UNCONFIRMED.
- Our-constraints lane describes the resumeClock hazard as a naive feed that 'would silently start quarters'. The verified code (epinoia/score/index.html:2330 and 2336-2337) also fails the other way. If the feed sets clock_ms to a reset 10:00 before setting running=true, which is what a timekeeper does at every interval, resumeClock takes the S.clockMs>0 early return. The period never advances and no period_start is logged.
- Existing-products lane frames ScoreBird as 'the only vendor that genuinely routes around venue wifi' via cellular. The ScoreBird FAQ page it cites does not mention cellular at all; the lane half-concedes this in its could-not-confirm list. The same FAQ's compatibility list contains only US brands (https://scorebird.com/faq), which makes ScoreBird irrelevant to UK halls whatever its transport.
- New fact bearing on every console-tap option, missing from the survey: under FIBA Official Basketball Rules 2024 Art. 46.1-46.2 the crew chief 'shall inspect and approve all equipment to be used during the game' and 'designate the official game clock, shot clock, stopwatch' (https://assets.fiba.basketball/image/upload/documents-corporate-fiba-official-rules-2024-v10a.pdf). Anything attached to the console is subject to referee approval on the night, not only venue permission.
- The SDR option says UK legality was 'not researched'. Wireless Telegraphy Act 2006 s.48(1) makes it an offence, without lawful authority, to use apparatus to obtain the contents of a message you are not an intended recipient of, or to disclose them (https://www.legislation.gov.uk/ukpga/2006/36/section/48). Whether scoreboard telemetry is covered is UNCONFIRMED, but the risk is concrete.
- scoreboard-hardware lane says Web Serial on Android 'has only just landed — Chrome 148 Beta for Android added Web Serial in April 2026'. Correction: Web Serial over Bluetooth RFCOMM reached stable Chrome 138 on Android (https://developer.chrome.com/release-notes/138; BCD chrome_android 138, https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Serial.json). The Chrome Platform Status entry 'Web Serial API on Android' with android_first 148 (https://chromestatus.com/api/v0/features/6043992171085824) is the broader rollout, and the blink-dev PSA puts non-Bluetooth serial via the Android Serial API at M149 on 'a limited set of devices' (https://groups.google.com/a/chromium.org/g/blink-dev/c/yGhvQ6mEmcY). The lanes contradict each other and the browser-apis lane has it right.
- browser-apis lane, WebUSB option, pairs google/web-serial-polyfill with 'FTDI/CP2102/CH340 class' adapters. Correction: the polyfill only matches CDC-ACM interfaces (class 2 and 10) and sends CDC SET_LINE_CODING. It has no vendor-chip support, so those adapters won't work through it (https://raw.githubusercontent.com/google/web-serial-polyfill/main/serial.ts).
- browser-apis lane, RFCOMM option, claims connect/disconnect events enable silent re-open 'after a cable pull or a dropout'. Correction: on Android, Chrome 'cannot fully support connected/disconnected events and the SerialPort.connected property... over Bluetooth yet due to system limitations' (https://groups.google.com/a/chromium.org/g/blink-dev/c/BqUGCcurReE). getPorts() persistence does hold.
- browser-apis lane, PWA option, calls a screen wake lock 'worth doing anyway'. Correction: the scorer already holds one and re-acquires it on visibilitychange (C:/Users/Admin/Documents/website_repo/epinoia/score/bootstrap.js:1967-2019). The same lane's 'Safari/iOS 16.4+' is also incomplete: wake lock was broken in Home Screen web apps until iOS/iPadOS 18.4 (https://bugs.webkit.org/show_bug.cgi?id=254545).
- existing-products lane says 'a ws:// connection from an https:// page is blocked as mixed content by every modern browser'. Correction: Chrome 141+ (fetch) and Chrome 147+ (WebSockets), on desktop and Android, exempt permission-gated requests to explicit private IPs and .local names from mixed-content checks (https://groups.google.com/a/chromium.org/g/blink-dev/c/cwu_RUmBpzY; https://groups.google.com/a/chromium.org/g/blink-dev/c/O6GMKt44Ups). The block still holds on iOS Safari.
- our-constraints lane, control-room keeper option, says desktop browser support is UNCONFIRMED. Correction: Web Serial 'is available on all desktop platforms (ChromeOS, Linux, macOS, and Windows) in Chrome 89' (https://developer.chrome.com/docs/capabilities/serial). A control-room PC in Chrome or Edge can read a USB-serial adapter in the page, with OS drivers handling FTDI and similar chips and no polyfill needed. Safari and Firefox can't.
- other-routes lane cites Apple Developer Forums thread 811690 for 'Safari blocks these requests as mixed content... with no user-facing override'. That thread doesn't say this: the Apple DTS reply only points to TN3179 and asks clarifying questions (https://developer.apple.com/forums/thread/811690). The claim is still right, but the sources are WebKit bug 171934, 'Don't treat loopback addresses... as mixed content', which is still NEW (https://bugs.webkit.org/show_bug.cgi?id=171934), and WebKit standards-positions #520, which records no position on Local Network Access (https://github.com/WebKit/standards-positions/issues/520).
- browser-apis lane lists beacio/iOSWebBLE pricing, iOS floor and maintenance as UNCONFIRMED. Now established: free, 'Requires iOS 26.2 or later', 'Designed for iPhone', v2.1.0 dated 26 Aug, individual developer Wojciech Kulma, native iOS picker for each connection (https://apps.apple.com/gb/app/ioswebble/id6761301368).
- browser-apis lane cites github.com/BoehlerBrothers/WebBLE as the WebBLE project and calls the BLE-bridging browsers 'free'. That repo was last pushed 2020-04-24 (https://api.github.com/repos/BoehlerBrothers/WebBLE). The maintained WebBLE is the daphtdazz project (https://daphtdazz.github.io/WebBLE/), and a search result suggests the WebBLE app is paid (UNCONFIRMED; the App Store page returned 429). Bluefy is confirmed free, v3.9.3, iOS 12+ (https://apps.apple.com/gb/app/bluefy-web-ble-browser/id1492822055).
- browser-apis lane, native iOS option, describes the alternative browser engine entitlement as EEA-only. Correction: App Review Guideline 2.5.6 now covers 'the EU and Japan' (https://developer.apple.com/app-store/review/guidelines/). The UK still isn't covered.
- browser-apis lane quotes Apple's tracking-prevention page with the sentence 'if we find that features and web APIs increase fingerprintability... we will not implement them until...'. The list actually sits under 'features we have decided to not yet implement due to fingerprinting, security, and other concerns, and where we do not yet see a path to resolving those concerns' (https://webkit.org/tracking-prevention/). The substance (Web Bluetooth, Serial API, Web USB, WebHID and Web NFC all listed) is correct.
- No lane mentions the FIBA LiveStats in-arena Broadcast (TV) Feed, which is the only real-time source for fed games. It is TCP on port 7677, and actions carry a timeActual UTC field (https://developer.geniussports.com/livestats/tvfeed/index_basketball.html). It is licence-gated: 'Broadcast Feed can be activated only via FLS7 License Code' (https://sportingpulse.freshdesk.com/support/solutions/articles/9000176548-livestats-version-7-data-streaming). Browsers can't open raw TCP outside Chrome Isolated Web Apps (https://developer.chrome.com/docs/iwa/direct-sockets), so it needs a native LAN bridge.
- PWA option: it says installing is 'worth doing anyway for the wake lock' and says to 'hold a Screen Wake Lock'. The scorer already does: epinoia/score/bootstrap.js:1967-1974 (keepTheScreenOn -> navigator.wakeLock.request('screen')).
- Web Serial on Android: the lanes contradict each other on milestones. browser-apis says full Web Serial on Android lands in 'M149'. scoreboard-hardware says Chrome 148 Beta added it. The Chrome Platform Status entry 'Web Serial API on Android' (https://chromestatus.com/api/v0/features/6043992171085824, fetched today) lists android: 148. MDN BCD lists chrome_android 138 for the RFCOMM-only partial implementation (https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Serial.json). The 'M149' figure is unsupported by chromestatus; I did not re-read the blink-dev PSA.
- Omission that changes the recommendation: no lane covers the FIBA LiveStats In-Arena (TV) Feed, a TCP socket on port 7677 of the LiveStats laptop whose action messages carry timeActual (UTC time of day) and centisecond clocks (https://developer.geniussports.com/livestats/tvfeed/index_basketball.html). This is the one local link that addresses fed-game timing.
- Omission: no lane checks the delivery path of the cloud feed. data.json is served from S3 via CloudFront with 'Cache-Control: max-age=30', and a cache-busting query string does not bypass it (X-Cache: Hit from cloudfront with the same Age). Measured today on game 2702560, which is finished; max-age on live games is UNCONFIRMED. This limits how much any poll-cadence fix can achieve.
- other-routes lane: 'sync.js coalesces into ~250ms frames' is slightly wrong. The coalescing is in live.js (FRAME_MS = 250 at live.js:36, leading-edge logic at live.js:568-584), and the first event of a burst is not delayed at all. The conclusion that the heartbeat is not the score's latency still holds.
