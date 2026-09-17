import UIKit
import UserNotifications

/// WHAT iOS SAYS ABOUT NOTIFICATIONS FOR THIS APP, AND APPLE'S ADDRESS FOR THIS IPHONE.
///
/// WKWebView has no Web Push: no push event in a service worker, no PushManager, no Notification.
/// So the app does natively what Chrome does for the Android app. It asks iOS for permission (only
/// when the website asks, through the bridge's push.enable, never at launch), registers with Apple
/// Push Notification service, and keeps the device token APNs hands back. The website saves that
/// token as this phone's address (apns:<apnsEnv>:<token>) and the server's notify function sends
/// to it through APNs.
///
/// ONE OBJECT, ON THE MAIN ACTOR. The AppDelegate feeds it iOS's registration callbacks, the bridge
/// awaits it, and it posts `Push.stateDidChange` whenever the permission or the token changes, so
/// the bridge can bring the page up to date.
@MainActor
final class Push {
    static let shared = Push()

    /// Posted on the main thread when `permission` or `token` changes.
    static let stateDidChange = Notification.Name("EpinoiaPushStateDidChange")

    /// How long push.enable waits for iOS's registration callback. The website's own timeout for
    /// the call is 25 s (epinoia/push.js), so this answers first.
    static let registrationTimeoutSeconds: UInt64 = 15

    private static let tokenDefaultsKey = "EpinoiaAPNsToken"

    /// THE APNs ENVIRONMENT THE TOKEN BELONGS TO. A token from a development-signed build only
    /// works against api.sandbox.push.apple.com and a store build's only against
    /// api.push.apple.com, so the server has to know which. DEBUG builds are the ones run from
    /// Xcode with a development profile.
    static var apnsEnvironment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    /// What the page knows, compared to decide whether it needs telling again.
    struct State: Equatable {
        let permission: String
        let token: String?
    }

    /// Last authorization status read from iOS. notDetermined until the first refresh, which the
    /// web view waits for before loading its first page.
    private(set) var status: UNAuthorizationStatus = .notDetermined

    /// Lower-case hex, as APNs and the website's endpoint format expect. KEPT ACROSS LAUNCHES in
    /// UserDefaults, so a page loaded before this launch's registration callback still gets the
    /// last known address.
    private(set) var token: String?

    /// push.enable calls waiting for iOS's registration callback. EACH IS RESUMED EXACTLY ONCE: the
    /// callback and the timeout both remove the continuation from this dictionary before resuming
    /// it, and whichever comes second finds nothing there.
    private var registrationWaiters: [UUID: CheckedContinuation<String?, Never>] = [:]

    private init() {
        token = UserDefaults.standard.string(forKey: Push.tokenDefaultsKey)
    }

    var permission: String { Push.permissionName(for: status) }

    var state: State { State(permission: permission, token: token) }

    /// The bridge's reply to push.status and push.enable: {permission, token, apnsEnv, error?}.
    /// A missing token is NSNull so the key reaches JavaScript as null, not as absent.
    func reply(error: String?) -> [String: Any] {
        var reply: [String: Any] = [
            "permission": permission,
            "token": jsonStringOrNull(token),
            "apnsEnv": Push.apnsEnvironment
        ]
        if let error = error {
            reply["error"] = error
        }
        return reply
    }

    /// iOS's status in the words the website uses (Notification.permission's, plus iOS's two
    /// extra grants): notDetermined is 'default', as in a browser that has not asked yet.
    static func permissionName(for status: UNAuthorizationStatus) -> String {
        switch status {
        case .authorized: return "granted"
        case .denied: return "denied"
        case .provisional: return "provisional"
        case .ephemeral: return "ephemeral"
        case .notDetermined: return "default"
        @unknown default: return "default"
        }
    }

    /// Provisional (quiet delivery) and ephemeral (App Clips) deliver notifications too.
    static func allowsNotifications(_ status: UNAuthorizationStatus) -> Bool {
        status == .authorized || status == .provisional || status == .ephemeral
    }

    // MARK: - Reading and asking

    /// Reads the status from iOS now. Settings can change it while the app is in the background,
    /// so this runs on every return to the foreground and before every push.* reply.
    @discardableResult
    func refreshStatus() async -> UNAuthorizationStatus {
        let fresh = await Push.fetchStatus()
        if fresh != status {
            status = fresh
            announce()
        }
        return fresh
    }

    /// LAUNCH AND RETURN TO THE FOREGROUND: register again whenever iOS already allows
    /// notifications. This never shows a prompt. Apple asks apps to register on every launch
    /// because the token can change (a restore, a reinstall); a changed token reaches the page as a
    /// permission event, and a setting switched on in the Settings app gets its first token here.
    func refreshAndRegisterIfAllowed() async {
        let current = await refreshStatus()
        if Push.allowsNotifications(current) {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    /// push.enable. Asks iOS the first time (the only time iOS will show its dialog), then, if
    /// notifications are allowed, registers and waits for the token. Registers again even when a
    /// token is cached, because the token can change; if Apple is slow the cached one is answered.
    /// Returns the error to put in the reply, if any.
    func enable() async -> String? {
        var failure: String?
        var current = await refreshStatus()
        if current == .notDetermined {
            failure = await Push.requestAuthorization()
            current = await refreshStatus()
        }
        guard Push.allowsNotifications(current) else { return failure }
        let registrationFailure = await register()
        return failure ?? registrationFailure
    }

    private func register() async -> String? {
        let id = UUID()
        let seconds = Push.registrationTimeoutSeconds
        return await withCheckedContinuation { (continuation: CheckedContinuation<String?, Never>) in
            registrationWaiters[id] = continuation
            UIApplication.shared.registerForRemoteNotifications()
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: seconds * 1_000_000_000)
                // A cached token is still a usable answer; only "no address at all" is an error.
                let failure: String? = Push.shared.token == nil
                    ? "Apple did not send a notification address within \(seconds) seconds."
                    : nil
                Push.shared.resumeWaiter(id, with: failure)
            }
        }
    }

    // MARK: - iOS's callbacks, from the AppDelegate

    func didRegister(deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(hex, forKey: Push.tokenDefaultsKey)
        let changed = hex != token
        token = hex
        resumeAllWaiters(with: nil)
        if changed {
            announce()
        }
    }

    /// Registration failed (no network, or on a simulator build without the aps-environment
    /// entitlement). The cached token, if any, is kept: it may well still be valid.
    func didFailToRegister(_ error: Error) {
        resumeAllWaiters(with: error.localizedDescription)
    }

    // MARK: - Helpers

    private func resumeWaiter(_ id: UUID, with failure: String?) {
        guard let continuation = registrationWaiters.removeValue(forKey: id) else { return }
        continuation.resume(returning: failure)
    }

    private func resumeAllWaiters(with failure: String?) {
        let waiting = Array(registrationWaiters.values)
        registrationWaiters.removeAll()
        for continuation in waiting {
            continuation.resume(returning: failure)
        }
    }

    private func announce() {
        NotificationCenter.default.post(name: Push.stateDidChange, object: nil)
    }

    /// The completion-handler APIs, wrapped. UserNotifications calls them on its own queue, and
    /// only a plain enum or string crosses back, so nothing here needs the main actor.
    nonisolated private static func fetchStatus() async -> UNAuthorizationStatus {
        await withCheckedContinuation { (continuation: CheckedContinuation<UNAuthorizationStatus, Never>) in
            UNUserNotificationCenter.current().getNotificationSettings { settings in
                continuation.resume(returning: settings.authorizationStatus)
            }
        }
    }

    /// iOS's own dialog. It resolves when the person answers; a refusal is not an error (the
    /// status then reads denied), only a failure to ask is.
    nonisolated private static func requestAuthorization() async -> String? {
        await withCheckedContinuation { (continuation: CheckedContinuation<String?, Never>) in
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, error in
                continuation.resume(returning: error?.localizedDescription)
            }
        }
    }
}
