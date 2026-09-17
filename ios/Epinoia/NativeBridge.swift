import UIKit
import WebKit

/// THE CONTRACT WITH THE WEBSITE: window.EpinoiaNative, the "epinoia" message handler, and the
/// 'epinoia-native' events. epinoia/push.js and epinoia/appmode.js depend on every name here, so
/// a change is a change on both sides (ios/README.md has the contract in full).
///
/// 1. BEFORE ANY PAGE SCRIPT RUNS, on this origin only, a user script defines
///      window.EpinoiaNative = { platform: 'ios', build, version, permission, token, apnsEnv, call }
///    with the values iOS reports when the page loads. permission and token stay writable (the app
///    and push.js both update them); everything else is fixed and the object is sealed. The values
///    are JSON-encoded by JSONSerialization, never pasted into the script as text.
///
/// 2. call(name, args) posts to a WKScriptMessageHandlerWithReply, so it returns a Promise. The
///    handler answers only the main frame of https://prophesyscouting.co.uk: a message from
///    anything else (an embedded frame, another site that somehow got into the web view) is
///    rejected with "not allowed". Every other answer is a dictionary; failures go in its `error`.
///
/// 3. EVENTS INTO THE PAGE, window 'epinoia-native' with detail:
///      {type: 'permission', permission, token}       the page's view went stale (see below)
///      {type: 'push', tag, kind, shown: true, opened: false, at}   shown while the app is open
///      {type: 'push', tag, kind, shown: true, opened: true, at}    tapped, after its page loads
///    Before each one, window.EpinoiaNative.permission and .token are brought up to date.
///
/// WHAT THE PAGE KNOWS. `pageState` is what the current page was last told: the values baked into
/// the user script when it committed, then every reply and event since. The page hears about a
/// change exactly once, from whichever comes first: the reply to the push.* call it is waiting on
/// (no events while one is in flight: the system prompt and the token callback both land during
/// push.enable), or else a permission event when the app is active, sent when the app returns to
/// the foreground and when a token arrives late.
@MainActor
final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply {
    static let handlerName = "epinoia"
    static let eventName = "epinoia-native"

    private weak var webView: WKWebView?

    /// WEAK: the content controller already holds this bridge strongly, as its message handler.
    private weak var contentController: WKUserContentController?

    /// The state baked into the user script currently installed, i.e. what the next page gets.
    private var installedState: Push.State?

    /// What the page on screen last heard. nil when no page of ours is showing.
    private var pageState: Push.State?

    /// push.status / push.enable calls the page is still waiting on.
    private var callsInFlight = 0

    /// Registers the handler and the first user script. Called before the web view's first load:
    /// a document-start script only reaches documents created after it is added. `controller` is
    /// the one in the web view's configuration, which WebViewController also keeps.
    func attach(to webView: WKWebView, contentController controller: WKUserContentController) {
        self.webView = webView
        contentController = controller
        controller.addScriptMessageHandler(self, contentWorld: .page, name: NativeBridge.handlerName)
        installBootstrapScript()
        NotificationCenter.default.addObserver(self,
                                               selector: #selector(pushStateDidChange),
                                               name: Push.stateDidChange,
                                               object: nil)
    }

    // MARK: - Calls from the page

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        let frame = message.frameInfo
        guard frame.isMainFrame, Site.isOurSecurityOrigin(frame.securityOrigin) else {
            replyHandler(nil, "not allowed")
            return
        }

        let body = message.body as? [String: Any]
        let name = (body?["name"] as? String) ?? ""

        switch name {
        case "push.status":
            // Asked now, not as the page loaded: Settings may have changed it meanwhile.
            callsInFlight += 1
            Task { @MainActor in
                await Push.shared.refreshStatus()
                self.finishPushCall(replyHandler, error: nil)
            }

        case "push.enable":
            callsInFlight += 1
            Task { @MainActor in
                let failure = await Push.shared.enable()
                self.finishPushCall(replyHandler, error: failure)
            }

        case "settings.open":
            replyHandler(NativeBridge.openNotificationSettings(), nil)

        case "app.info":
            let info: [String: Any] = [
                "build": AppInfo.build,
                "version": AppInfo.version,
                "systemVersion": UIDevice.current.systemVersion,
                "model": "iPhone"
            ]
            replyHandler(info, nil)

        default:
            replyHandler(["error": "Unknown method: \(name)"], nil)
        }
    }

    /// The page's properties are updated in the same breath as the reply (push.js's nativeRemember
    /// does the same from the reply), so window.EpinoiaNative is right even for code that reads it
    /// without awaiting the call.
    private func finishPushCall(_ replyHandler: (Any?, String?) -> Void, error: String?) {
        callsInFlight = max(0, callsInFlight - 1)
        runInPage(state: Push.shared.state, detail: nil)
        replyHandler(Push.shared.reply(error: error), nil)
    }

    /// iOS 16's deep link to this app's page in Settings > Notifications. Shared with the
    /// epinoia://notification-settings link the web view intercepts.
    static func openNotificationSettings() -> [String: Any] {
        guard let url = URL(string: UIApplication.openNotificationSettingsURLString) else {
            return ["ok": false, "error": "iOS did not give a notification settings address."]
        }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
        return ["ok": true]
    }

    // MARK: - Page lifecycle, from WebViewController

    /// A new document of ours now holds the state that was baked into the user script.
    func pageDidCommit() {
        pageState = Site.isOurOrigin(webView?.url) ? installedState : nil
    }

    /// The app is in the foreground again; Push has just re-read the status from iOS.
    func appDidBecomeActive() {
        sendPermissionIfChanged()
    }

    func sendPush(_ payload: PushPayload, opened: Bool) {
        let detail: [String: Any] = [
            "type": "push",
            "tag": jsonStringOrNull(payload.tag),
            "kind": jsonStringOrNull(payload.kind),
            "shown": true,
            "opened": opened,
            "at": payload.at
        ]
        runInPage(state: Push.shared.state, detail: detail)
    }

    // MARK: - Keeping the page up to date

    @objc private func pushStateDidChange() {
        installBootstrapScript()
        sendPermissionIfChanged()
    }

    private func sendPermissionIfChanged() {
        guard callsInFlight == 0,
              UIApplication.shared.applicationState == .active,
              let known = pageState else { return }
        let current = Push.shared.state
        guard known != current else { return }
        let detail: [String: Any] = [
            "type": "permission",
            "permission": current.permission,
            "token": jsonStringOrNull(current.token)
        ]
        runInPage(state: current, detail: detail)
    }

    /// REPLACES THE USER SCRIPT with one carrying the current values. WKUserContentController
    /// scripts are copied into each new document, so this changes what the NEXT page load sees;
    /// the page on screen is updated by runInPage.
    private func installBootstrapScript() {
        guard let controller = contentController else { return }
        let state = Push.shared.state
        controller.removeAllUserScripts()
        controller.addUserScript(WKUserScript(source: NativeBridge.bootstrapSource(state),
                                              injectionTime: .atDocumentStart,
                                              forMainFrameOnly: true,
                                              in: .page))
        installedState = state
    }

    /// Updates window.EpinoiaNative's permission and token and, with a detail, dispatches the
    /// event. The script checks the origin itself as well: the web view may have moved to another
    /// document between the check here and the script running.
    private func runInPage(state: Push.State, detail: [String: Any]?) {
        guard let webView = webView, Site.isOurOrigin(webView.url) else { return }
        var message: [String: Any] = [
            "origin": Site.origin,
            "event": NativeBridge.eventName,
            "permission": state.permission,
            "token": jsonStringOrNull(state.token)
        ]
        if let detail = detail {
            message["detail"] = detail
        }
        let source = """
        (function (m) {
          if (location.origin !== m.origin) return;
          var api = window.EpinoiaNative;
          if (api) {
            try { api.permission = m.permission; api.token = m.token; } catch (e) { /* sealed by someone else */ }
          }
          if (m.detail) window.dispatchEvent(new CustomEvent(m.event, { detail: m.detail }));
        })(\(NativeBridge.json(message)));
        """
        webView.evaluateJavaScript(source, completionHandler: nil)
        pageState = state
    }

    // MARK: - The user script

    private static func bootstrapSource(_ state: Push.State) -> String {
        let values: [String: Any] = [
            "origin": Site.origin,
            "handler": NativeBridge.handlerName,
            "build": AppInfo.build,
            "version": AppInfo.version,
            "permission": state.permission,
            "token": jsonStringOrNull(state.token),
            "apnsEnv": Push.apnsEnvironment
        ]
        // The handler is looked up once, here, before any page script could replace window.webkit.
        return """
        (function (init) {
          'use strict';
          if (location.origin !== init.origin) return;
          if (window.EpinoiaNative) return;
          var handlers = window.webkit && window.webkit.messageHandlers;
          var handler = handlers ? handlers[init.handler] : null;
          var api = {};
          var fixed = function (key, value) {
            Object.defineProperty(api, key, { value: value, enumerable: true, writable: false, configurable: false });
          };
          fixed('platform', 'ios');
          fixed('build', init.build);
          fixed('version', init.version);
          api.permission = init.permission;
          api.token = init.token;
          fixed('apnsEnv', init.apnsEnv);
          fixed('call', function (name, args) {
            if (!handler) return Promise.reject(new Error('The EPINOIΛ app bridge is not available.'));
            try {
              return handler.postMessage({ name: String(name), args: (args && typeof args === 'object') ? args : {} });
            } catch (e) {
              return Promise.reject(e);
            }
          });
          Object.seal(api);
          Object.defineProperty(window, 'EpinoiaNative', { value: api, enumerable: true, writable: false, configurable: false });
        })(\(NativeBridge.json(values)));
        """
    }

    /// JSON text for embedding in a script. "{}" if encoding ever failed, which makes both scripts
    /// stop at their origin check rather than run with half the values.
    private static func json(_ object: [String: Any]) -> String {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object, options: []),
              let text = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        return text
    }
}
