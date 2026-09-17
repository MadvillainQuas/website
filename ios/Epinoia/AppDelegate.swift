import UIKit
import UserNotifications

/// THE APP'S ENTRY POINT, AND iOS'S NOTIFICATION CALLBACKS.
///
/// The window and the web view belong to SceneDelegate. What lives here is what iOS delivers to
/// the application rather than to a scene:
///
/// 1. THE NOTIFICATION CENTER'S DELEGATE, set before launching finishes. That timing is what makes
///    iOS deliver the tap that launched the app; set any later, a cold-start tap is lost.
/// 2. THE APNs REGISTRATION RESULT, the device token or the error, handed to Push, which the
///    bridge's push.enable is waiting on.
///
/// Nothing here asks for notification permission. The website asks, in context, when someone
/// turns game alerts on (the bridge's push.enable), because iOS shows its dialog only once ever.
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Push.shared.didRegister(deviceToken: deviceToken)
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Push.shared.didFailToRegister(error)
    }
}

/// NONISOLATED, THEN ONTO THE MAIN ACTOR. UserNotifications does not promise which thread these
/// run on, so each one copies the plain values it needs out of iOS's objects, answers iOS at
/// once, and hops to the main actor for everything that touches the web view.
extension AppDelegate: UNUserNotificationCenterDelegate {

    /// A NOTIFICATION WHILE THE APP IS OPEN. iOS shows nothing in the foreground unless asked, and
    /// a game alert that only appears once the app is closed would look lost, so it is shown as a
    /// banner with its sound, and the page is told (the site's "check this phone" test waits for it).
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            willPresent notification: UNNotification,
                                            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let payload = PushPayload(userInfo: notification.request.content.userInfo)
        completionHandler([.banner, .list, .sound])
        Task { @MainActor in
            AppRouter.shared.notificationPresented(payload)
        }
    }

    /// A NOTIFICATION TAPPED, whether the app was open, in the background or not running. Only the
    /// default action (a tap on the notification itself) opens anything; a dismissal does not.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            didReceive response: UNNotificationResponse,
                                            withCompletionHandler completionHandler: @escaping () -> Void) {
        let isTap = response.actionIdentifier == UNNotificationDefaultActionIdentifier
        let payload = PushPayload(userInfo: response.notification.request.content.userInfo)
        completionHandler()
        guard isTap else { return }
        Task { @MainActor in
            AppRouter.shared.notificationTapped(payload)
        }
    }
}
