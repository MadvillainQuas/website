import UIKit
import UserNotifications

/// THE WINDOW, UNIVERSAL LINKS, AND COMING BACK TO THE FOREGROUND.
///
/// One scene (Info.plist turns multiple windows off): one window whose root is the web view.
///
/// UNIVERSAL LINKS arrive in two places. A link that LAUNCHES the app is in the connection
/// options, before the web view exists, so it becomes the first page instead of HOME. A link
/// that arrives while the app is running comes through scene(_:continue:). An /epinoia page opens
/// here; anything else goes on to the Safari app.
///
/// EVERY RETURN TO THE FOREGROUND clears the badge, re-reads iOS's notification setting (it may
/// have been changed in Settings meanwhile), registers again if notifications are allowed (the
/// token can change), and tells the page if what it knows is out of date.
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene,
               willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        var initialURL: URL?
        let browsing = connectionOptions.userActivities.first(where: { $0.activityType == NSUserActivityTypeBrowsingWeb })
        if let link = browsing?.webpageURL {
            if Site.isEpinoia(link) {
                initialURL = link
            } else if Site.isWeb(link) {
                UIApplication.shared.open(link, options: [:], completionHandler: nil)
            }
        }

        let window = UIWindow(windowScene: windowScene)
        window.backgroundColor = Site.ground
        window.rootViewController = WebViewController(initialURL: initialURL)
        self.window = window
        window.makeKeyAndVisible()
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        guard userActivity.activityType == NSUserActivityTypeBrowsingWeb,
              let url = userActivity.webpageURL else { return }
        AppRouter.shared.openUniversalLink(url)
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        UNUserNotificationCenter.current().setBadgeCount(0, withCompletionHandler: nil)
        Task { @MainActor in
            await Push.shared.refreshAndRegisterIfAllowed()
            AppRouter.shared.appDidBecomeActive()
        }
    }
}
