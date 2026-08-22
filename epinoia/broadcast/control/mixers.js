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

  return {
    connect, request, layout, take,
    get ready() { return ready; },
    close() { try { ws && ws.close(); } catch (_) {} }
  };
}

/* ========================================================================= */
/* vMix — the web controller on 8088                                         */
/* ========================================================================= */
/* Fire-and-forget over HTTP. vMix answers without CORS headers, so the browser
   will not let this page READ the reply — which is fine, because there is
   nothing in it worth reading. no-cors means the request is still sent.

   The cost is honest and worth stating: a command that fails looks exactly
   like one that worked. So the UI never claims vMix did anything; it says the
   command was sent. */
function vmix(host, port) {
  const base = 'http://' + (host || 'localhost') + ':' + (port || 8088) + '/api/?';
  const fire = params => fetch(base + new URLSearchParams(params).toString(),
    { mode: 'no-cors', cache: 'no-store' }).then(() => true).catch(() => false);

  return {
    /* One input per graphic. vMix names an input by its title, so re-running
       this adds duplicates — which is why the UI says so before it runs. */
    async layout(graphics) {
      for (const g of graphics) {
        await fire({ Function: 'AddInput', Value: 'Browser|' + g.url });
        await fire({ Function: 'SetInputName', Input: g.url, Value: g.name });
      }
      return true;
    },
    /* Overlay channel 1 by default: the channel a lower third lives on in every
       vMix production anybody has ever set up. */
    take: (name, channel) => fire({ Function: 'OverlayInput' + (channel || 1) + 'In', Input: name }),
    clear: channel => fire({ Function: 'OverlayInput' + (channel || 1) + 'Out' })
  };
}

return { obs, vmix, sha256b64, authString, VERSION: '1.0.0' };
}));
