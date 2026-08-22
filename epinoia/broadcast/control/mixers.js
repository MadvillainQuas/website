'use strict';
/* ============================================================================
   TALKING TO THE MIXER, NOT JUST WRITING IT A FILE.

   A scene-collection export is a good first day and a bad second one: it lays
   the sources out and then every "take" is still a director hunting an eyeball
   icon in OBS while the play they wanted to caption finishes without them.

   Both of the mixers that matter for this market can be driven from a browser,
   and neither needs a plugin:

     OBS 28+   obs-websocket v5 is BUILT IN. Tools → WebSocket Server Settings,
               tick it, copy the password. The protocol is JSON over a socket
               with a SHA-256 challenge, which is about sixty lines.

     vMix      the web controller is an HTTP endpoint on 8088. It sends no CORS
               headers, so a browser cannot read the reply — but it does not
               need to. Commands are fire-and-forget and that is exactly what
               taking a graphic is.

   WHY ws://localhost IS ALLOWED FROM AN HTTPS PAGE. Mixed content would
   normally block it, and every integration like this dies there. Localhost is
   the exception: browsers treat 127.0.0.1 as a potentially trustworthy origin,
   so a page served over TLS may open a plain socket to the machine it is
   running on. That is the whole reason this approach works at all, and it is
   worth writing down because it looks like it should not.

   NOTHING HERE IS LOAD-BEARING. If OBS is not running, or the password is
   wrong, or somebody is on CasparCG, every graphic is still a URL and the
   control room still switches a live layer over Supabase. This is the fast
   path, not the only one.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaMixers = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

/* ========================================================================= */
/* OBS — obs-websocket v5                                                    */
/* ========================================================================= */

const b64 = buf => {
  let s = '';
  new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); });
  return btoa(s);
};

async function sha256b64(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return b64(buf);
}

/* The v5 handshake: the server sends a salt and a challenge, and the client
   proves it knows the password without ever sending it.

     base64(sha256( base64(sha256(password + salt)) + challenge ))

   WHAT IS AND IS NOT VERIFIED HERE. sha256b64 is checked against known SHA-256
   values — the empty string and "abc" — in both base64 and hex, so the hashing
   and the encoding are certainly right, and the composition above is the
   documented sequence. What has NOT been tested is a real handshake against a
   real OBS, because that needs OBS running on the machine. If a correct
   password is ever refused, this function is the first place to look and the
   protocol document is the arbiter. */
async function authString(password, salt, challenge) {
  const secret = await sha256b64(password + salt);
  return sha256b64(secret + challenge);
}

function obs() {
  let ws = null, nextId = 1, pending = new Map(), onState = () => {};
  let ready = false;

  function send(op, d) { ws.send(JSON.stringify({ op, d })); }

  function request(requestType, requestData) {
    return new Promise((resolve, reject) => {
      if (!ready) { reject(new Error('not connected to OBS')); return; }
      const requestId = 'ep' + (nextId++);
      pending.set(requestId, { resolve, reject });
      send(6, { requestType, requestId, requestData: requestData || {} });
      /* A request that never comes back would leave a button disabled for ever;
         OBS answers in milliseconds or it is not going to. */
      setTimeout(() => {
        if (!pending.has(requestId)) return;
        pending.delete(requestId);
        reject(new Error(requestType + ' timed out'));
      }, 8000);
    });
  }

  function connect(opts) {
    const { host = 'localhost', port = 4455, password = '', onStatus } = opts || {};
    onState = onStatus || (() => {});
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
      try {
        ws = new WebSocket('ws://' + host + ':' + port);
      } catch (err) { done(reject, err); return; }

      ws.onopen = () => onState('handshaking');

      ws.onmessage = async ev => {
        let m; try { m = JSON.parse(ev.data); } catch (_) { return; }

        if (m.op === 0) {                      // Hello
          const d = { rpcVersion: m.d.rpcVersion };
          if (m.d.authentication) {
            if (!password) {
              done(reject, new Error('OBS is asking for a password'));
              try { ws.close(); } catch (_) {}
              return;
            }
            d.authentication = await authString(password,
              m.d.authentication.salt, m.d.authentication.challenge);
          }
          send(1, d);
          return;
        }

        if (m.op === 2) {                      // Identified
          ready = true; onState('connected'); done(resolve, true); return;
        }

        if (m.op === 7) {                      // RequestResponse
          const p = pending.get(m.d.requestId);
          if (!p) return;
          pending.delete(m.d.requestId);
          if (m.d.requestStatus && m.d.requestStatus.result) p.resolve(m.d.responseData || {});
          else p.reject(new Error((m.d.requestStatus &&
                (m.d.requestStatus.comment || m.d.requestStatus.code)) || 'OBS refused'));
        }
      };

      ws.onerror = () => {
        /* A refused socket and a wrong password look identical from here, so
           the message names both rather than guessing. */
        done(reject, new Error('could not reach OBS — is the WebSocket server ' +
          'switched on in Tools → WebSocket Server Settings?'));
      };
      ws.onclose = () => {
        ready = false; onState('closed');
        pending.forEach(p => p.reject(new Error('OBS disconnected')));
        pending.clear();
        done(reject, new Error('OBS closed the connection'));
      };
    });
  }

  /* Build the whole rundown inside OBS: one scene, one browser source per
     graphic, the scorebug visible and everything else hidden.

     RE-RUNNABLE ON PURPOSE. A director will press this twice — after changing
     a colour, after switching fixture — and the second press must update the
     URLs rather than pile up a second set of sources. So an input that already
     exists is reconfigured, not recreated. */
  async function layout(sceneName, graphics, onProgress) {
    const say = onProgress || (() => {});

    const { scenes } = await request('GetSceneList');
    const have = (scenes || []).some(s => s.sceneName === sceneName);
    if (!have) { say('creating the scene'); await request('CreateScene', { sceneName }); }

    const { inputs } = await request('GetInputList', {});
    const known = new Set((inputs || []).map(i => i.inputName));

    for (let i = 0; i < graphics.length; i++) {
      const g = graphics[i];
      say('source ' + (i + 1) + ' of ' + graphics.length + ' — ' + g.name);
      const settings = {
        url: g.url, width: 1920, height: 1080,
        fps_custom: false, reroute_audio: false,
        restart_when_active: true,
        /* a hidden layer must not hold a socket open for two hours */
        shutdown: true
      };
      if (known.has(g.name)) {
        await request('SetInputSettings', { inputName: g.name, inputSettings: settings });
        /* it exists, but perhaps not in THIS scene */
        try { await request('GetSceneItemId', { sceneName, sourceName: g.name }); }
        catch (_) { await request('CreateSceneItem', { sceneName, sourceName: g.name }); }
      } else {
        await request('CreateInput', {
          sceneName, inputName: g.name, inputKind: 'browser_source',
          inputSettings: settings, sceneItemEnabled: !!g.visible
        });
      }
      try {
        const { sceneItemId } = await request('GetSceneItemId',
          { sceneName, sourceName: g.name });
        await request('SetSceneItemEnabled',
          { sceneName, sceneItemId, sceneItemEnabled: !!g.visible });
      } catch (_) { /* a source that will not report an id still exists */ }

      /* AND MAKE IT RELOAD. Found by testing against a real OBS: the embedded
         browser caches the page, and pointing an existing source at the same
         URL does not restart it — so a graphic rebuilt after a colour change,
         or after the fixture changed, keeps showing what it showed before.
         Twenty minutes of "why has it not updated" before anybody suspects a
         cache. The properties button is the same "Refresh cache of current
         page" a person would press by hand. */
      /* A COLD START, NOT A REFRESH. Found by testing against a real OBS twice:
         refreshnocache reports success and changes nothing a screenshot can
         see. Hiding a source with shutdown:true tears the browser down
         completely, so showing it again is a fresh load — which is the only
         sequence that reliably picked up a stylesheet change. Both are sent,
         because the refresh costs nothing and older builds may want it. */
      try {
        const { sceneItemId } = await request('GetSceneItemId',
          { sceneName, sourceName: g.name });
        await request('SetSceneItemEnabled',
          { sceneName, sceneItemId, sceneItemEnabled: false });
        await request('SetSceneItemEnabled',
          { sceneName, sceneItemId, sceneItemEnabled: !!g.visible });
      } catch (_) { /* a source that will not report an id still exists */ }
      try {
        await request('PressInputPropertiesButton',
          { inputName: g.name, propertyName: 'refreshnocache' });
      } catch (_) { /* older OBS: the source still reloads when next shown */ }
    }
    say('done');
    return true;
  }

  /* Taking a graphic: show one, hide the others. Done by name, so it works
     whatever order the sources ended up in. */
  async function take(sceneName, showName, allNames) {
    for (const name of allNames) {
      try {
        const { sceneItemId } = await request('GetSceneItemId', { sceneName, sourceName: name });
        await request('SetSceneItemEnabled',
          { sceneName, sceneItemId, sceneItemEnabled: name === showName });
      } catch (_) { /* a graphic the director never imported is not an error */ }
    }
    return true;
  }

  /* ---- going live ------------------------------------------------------
     WE DRIVE THE TRANSPORT, NOT THE CREDENTIALS.

     obs-websocket will happily let this page write a stream key through
     SetStreamServiceSettings, and it must not. A key typed into a web page is
     a key that page is now responsible for — in localStorage, in a form field,
     in a screenshot somebody takes of the control room. OBS already holds it,
     safely, and the destination is set once a season.

     So: start, stop, and say what is happening. If there is no destination
     configured the page says so and points at OBS's own settings, which is
     both the honest answer and the one that leaves the key where it belongs. */
  const streamStatus = () => request('GetStreamStatus');
  const recordStatus = () => request('GetRecordStatus');
  const startStream  = () => request('StartStream');
  const stopStream   = () => request('StopStream');
  const startRecord  = () => request('StartRecord');
  const stopRecord   = () => request('StopRecord');
  const videoSettings = () => request('GetVideoSettings');

  /* Whether OBS has anywhere to send it. Read so the page can refuse to offer
     "go live" as though it would work — pressing it with nothing configured
     fails with a message about an output, which tells nobody anything. */
  async function destination() {
    try {
      const svc = await request('GetStreamServiceSettings');
      const s = svc.streamServiceSettings || {};
      return { type: svc.streamServiceType || null,
               ready: !!(s.key && String(s.key).length),
               /* the SERVER, never the key — a URL is not a secret and it is
                  the half that tells an operator which channel this is */
               server: s.server || null,
               /* WHICH PLATFORM, WITHOUT ASKING ANYBODY.

                  OBS knows: either as a bundled service name ("YouTube -
                  RTMPS") or as an ingest host, and an ingest host names its
                  platform unambiguously. So the video row gets its provider
                  from what the encoder is actually configured for rather than
                  from a dropdown somebody can get wrong, which is how a Twitch
                  link ends up on a YouTube row.

                  WHAT OBS CANNOT TELL US IS THE WATCH URL, and it is worth
                  being exact about why rather than hunting for a request that
                  does not exist. YouTube issues a watch URL to the BROADCAST.
                  OBS holds an ingest URL and a stream key, which are what an
                  encoder needs and are not derivable from one another; even
                  with the account connected, obs-websocket exposes no
                  broadcast id. The two honest routes are the league channel id
                  stored once (migration 0083) or a single paste of the link,
                  and both are offered. */
               service: s.service || null,
               provider: (self.EpinoiaVideo
                 ? self.EpinoiaVideo.providerFromServer(s.server, s.service) : null) };
    } catch (_) { return { type: null, ready: false, server: null, provider: null }; }
  }

  /* HOW LONG OBS SAYS IT HAS BEEN STREAMING, which is the only trustworthy
     answer to "when did the stream start".

     A button press in this page is not that answer: the stream may have been
     started in OBS directly, or twenty minutes before anybody opened the
     control room, or the page may have been reloaded since. OBS counts the
     duration itself, from the output actually starting, so the moment it began
     is now minus that — and it is turned into an instant on the SERVER, from a
     duration, so no clock is ever compared across two machines.

     Returns null when nothing is streaming, which is not the same as zero. */
  async function streamStartedMsAgo() {
    try {
      const st = await request('GetStreamStatus');
      if (!st.outputActive) return null;
      return Math.max(0, Math.round(st.outputDuration || 0));
    } catch (_) { return null; }
  }

  /* Point OBS at a destination. rtmp_custom with an explicit server rather
     than rtmp_common with a service NAME: the bundled service list changes
     between OBS versions and a name that is not in it fails in a way nobody
     can debug from a sports hall, whereas an ingest URL is an ingest URL. */
  const setDestination = (server, key) => request('SetStreamServiceSettings', {
    streamServiceType: 'rtmp_custom',
    streamServiceSettings: { server, key, use_auth: false }
  });

  return {
    kind: 'obs', readable: true, drives: true,
    connect, request, layout, take, setDestination,
    streamStatus, recordStatus, startStream, stopStream,
    startRecord, stopRecord, videoSettings, destination, streamStartedMsAgo,
    get ready() { return ready; },
    close() { try { ws && ws.close(); } catch (_) {} }
  };
}

/* ========================================================================= */
/* vMix — the Web Controller on 8088                                         */
/* ========================================================================= */
/* IT IS TRIED BOTH WAYS, BECAUSE THE ANSWER DEPENDS ON THE INSTALL.

   The vMix Web Controller answers every command over plain HTTP and, in the
   versions this was written against, without CORS headers — so a browser sends
   the request and is then forbidden from reading the reply. Survivable for
   commands; fatal for state. Without a reply we cannot know which inputs
   exist, so re-running the layout would add a second set of twelve.

   So this probes once. If the reply is readable — a newer vMix, a reverse
   proxy in front of it, a browser started with the check relaxed — everything
   works properly: the input list is read, the layout becomes a diff rather
   than an append, and streaming state is reported honestly. If it is not, the
   same commands go out blind and the interface says SENT rather than claiming
   that anything worked.

   The difference is stated in the interface rather than hidden, because "the
   command was sent" and "the command succeeded" are genuinely different things
   and an operator troubleshooting at six o'clock needs to know which one they
   have got. */
function vmix(host, port) {
  const base = 'http://' + (host || 'localhost') + ':' + (port || 8088) + '/api/';
  let readable = null;                 // null = not probed yet
  let state = { inputs: [], streaming: false, recording: false, version: null };

  const qs = params => base + '?' + new URLSearchParams(params).toString();

  /* Blind send. Always resolves: no-cors yields an opaque response that says
     nothing at all, and treating "no exception" as success would be a lie. */
  const fire = params => fetch(qs(params), { mode: 'no-cors', cache: 'no-store' })
    .then(() => true).catch(() => false);

  /* Readable send, used once the probe has said it works. */
  const call = async params => {
    const r = await fetch(qs(params), { cache: 'no-store' });
    return r.ok;
  };

  const send = params => (readable ? call(params).catch(() => fire(params)) : fire(params));

  /* ---- reading the state -------------------------------------------------
     vMix returns its whole state as XML. Parsed with DOMParser rather than by
     regular expression: an input title contains whatever a person typed into
     it, including the angle brackets that would end a naive match. */
  async function probe() {
    try {
      const r = await fetch(base, { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const doc = new DOMParser().parseFromString(await r.text(), 'text/xml');
      if (doc.querySelector('parsererror')) throw new Error('not XML');
      const txt = sel => { const n = doc.querySelector(sel); return n ? n.textContent : ''; };
      readable = true;
      state = {
        version: txt('vmix > version') || null,
        streaming: /true/i.test(txt('vmix > streaming')),
        recording: /true/i.test(txt('vmix > recording')),
        inputs: [].slice.call(doc.querySelectorAll('vmix > inputs > input')).map(n => ({
          key: n.getAttribute('key'),
          number: n.getAttribute('number'),
          title: n.getAttribute('title') || n.textContent || '',
          type: n.getAttribute('type') || ''
        }))
      };
      return { readable: true, state };
    } catch (_) {
      readable = false;
      return { readable: false, state };
    }
  }

  const find = title => state.inputs.find(i => i.title === title);

  /* ---- the rundown -------------------------------------------------------
     One browser input per graphic, named so a human can find it in the input
     list. When the state is readable this is a proper upsert: an input that
     already exists has its URL rewritten instead of being added again. When it
     is not, the caller warns first — the only honest thing to do with a
     command whose effect cannot be observed. */
  async function layout(graphics, onProgress) {
    const say = onProgress || (() => {});
    if (readable === null) await probe();
    if (readable) await probe();                 // a fresh list before diffing

    for (let i = 0; i < graphics.length; i++) {
      const g = graphics[i];
      say('input ' + (i + 1) + ' of ' + graphics.length + ' — ' + g.name);
      const have = readable ? find(g.name) : null;
      if (have) {
        /* Point it at the current URL and force a reload. The vMix browser
           input caches exactly as the OBS one does, so a graphic rebuilt after
           a colour change otherwise keeps showing what it showed before — the
           same twenty minutes of "why has it not updated" that cost us a
           session against OBS. */
        await send({ Function: 'SetBrowserURL', Input: have.key, Value: g.url });
        await send({ Function: 'BrowserReload', Input: have.key });
      } else {
        await send({ Function: 'AddInput', Value: 'Browser|' + g.url });
        /* AddInput leaves the new input selected, and Input=0 is the vMix word
           for "the one just added" — the only handle available without a
           readable reply, and the correct handle even with one. */
        await send({ Function: 'SetInputName', Input: '0', Value: g.name });
      }
    }
    if (readable) await probe();
    say('done');
    return true;
  }

  /* ---- taking ------------------------------------------------------------
     Overlay channel 1 by default: the channel a lower third lives on in every
     vMix production anybody has ever set up. An overlay channel holds one
     input, so putting a graphic on it takes the previous one off in the same
     command — which is what a take is. */
  async function take(name, channel) {
    const ch = channel || 1;
    const hit = readable ? find(name) : null;
    return send({ Function: 'OverlayInput' + ch + 'In', Input: hit ? hit.key : name });
  }
  const clear = channel => send({ Function: 'OverlayInput' + (channel || 1) + 'Out' });
  const clearAll = () => Promise.all([1, 2, 3, 4].map(ch =>
    send({ Function: 'OverlayInput' + ch + 'Out' })));

  /* ---- transport ---------------------------------------------------------
     vMix reports WHETHER it is streaming but not for how long, so unlike OBS
     it cannot say when the stream started. The control room falls back to the
     moment the button was pressed, and says which one it used. */
  const startStream = () => send({ Function: 'StartStreaming' });
  const stopStream  = () => send({ Function: 'StopStreaming' });
  const startRecord = () => send({ Function: 'StartRecording' });
  const stopRecord  = () => send({ Function: 'StopRecording' });

  async function streamStatus() {
    if (readable === null) await probe();
    if (!readable) return { outputActive: null, outputDuration: 0, unknown: true };
    await probe();
    return { outputActive: state.streaming, outputDuration: 0, unknown: false };
  }
  async function recordStatus() {
    if (!readable) return { outputActive: null, unknown: true };
    return { outputActive: state.recording, unknown: false };
  }
  /* vMix keeps its destination in its own settings and does not publish it, so
     the honest answer is "cannot tell" rather than "nothing is set" — the
     second would have the control room refusing to offer a working button. */
  const destination = async () => ({ type: null, ready: null, server: null,
                                     provider: null, unknown: true });
  const streamStartedMsAgo = async () => null;

  return {
    kind: 'vmix', drives: true,
    get readable() { return !!readable; },
    get state() { return state; },
    probe, layout, take, clear, clearAll,
    startStream, stopStream, startRecord, stopRecord,
    streamStatus, recordStatus, destination, streamStartedMsAgo,
    close() {}
  };
}

/* ========================================================================= */
/* Wirecast, and everything else — ONE BROWSER SOURCE, SWITCHED FROM HERE     */
/* ========================================================================= */
/* THERE IS NO WIRECAST CONTROL API TO WRITE AGAINST, and saying so plainly is
   more useful than shipping something that half works. Wirecast automates
   through AppleScript on macOS and through keyboard shortcuts everywhere else;
   neither is reachable from a web page, and no amount of wanting changes it.

   It turns out not to matter, because the mixer was never the right place to
   switch a graphic.

   A production that imports twelve browser sources asks the MIXER which one is
   visible. A production that imports ONE — the live layer, which this platform
   has had from the beginning — asks the PLATFORM, over the same socket the
   scores already travel on. The take button reaches that layer directly. The
   mixer is not consulted, needs no API, and needs to know nothing at all.

   So this adapter drives nothing and connects to nothing. It exists so the
   interface can say that clearly instead of drawing a green light, and so the
   setup steps and the one URL are somewhere a person will find them. It is the
   path to recommend for Wirecast, Livestream Studio, Streamlabs Desktop,
   mimoLive, Ecamm, and any hardware switcher with an HTML input — which is to
   say, for everything. */
function manual(product) {
  return {
    kind: 'manual',
    product: product || 'any mixer',
    readable: false,
    /* The important line. Taking a graphic works perfectly; it simply does not
       go through here. Reporting drives:false is what stops the control room
       from claiming it is driving a mixer that it is not. */
    drives: false,
    async probe() { return { readable: false, state: null }; },
    async layout() { return false; },
    async take() { return false; },
    async clear() { return false; },
    async streamStatus() { return { outputActive: null, outputDuration: 0, unknown: true }; },
    async recordStatus() { return { outputActive: null, unknown: true }; },
    async destination() { return { type: null, ready: null, server: null, unknown: true }; },
    async streamStartedMsAgo() { return null; },
    close() {}
  };
}

return { obs, vmix, manual, sha256b64, authString, VERSION: '1.1.0' };
}));
