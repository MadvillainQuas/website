import UIKit

/// WHERE NOTIFICATIONS AND LINKS FROM OUTSIDE GO, EVEN BEFORE THERE IS A WEB VIEW.
///
/// A notification tapped while the app is not running launches it, and iOS may deliver the tap
/// before the scene has made its window. The router keeps that tap (and a universal link that
/// arrives the same way) until WebViewController attaches, then hands it over; from then on it
/// passes everything straight through.
@MainActor
final class AppRouter {
    static let shared = AppRouter()

    private weak var web: WebViewController?
    private var pendingTap: PushPayload?
    private var pendingLink: URL?

    private init() {}

    func attach(_ controller: WebViewController) {
        web = controller
        if let link = pendingLink {
            pendingLink = nil
            controller.load(link)
        }
        // After the link: a tap is the more recent intent, so its page is the one that loads.
        if let tap = pendingTap {
            pendingTap = nil
            controller.notificationTapped(tap)
        }
    }

    /// A notification arrived while the app is in the foreground. With no page there is nobody to
    /// tell, so nothing is kept.
    func notificationPresented(_ payload: PushPayload) {
        web?.notificationPresented(payload)
    }

    func notificationTapped(_ payload: PushPayload) {
        if let web = web {
            web.notificationTapped(payload)
        } else {
            pendingTap = payload
        }
    }

    /// A universal link (https://prophesyscouting.co.uk/... tapped in Mail, Messages, Notes). The
    /// site's apple-app-site-association file should only claim /epinoia paths, but whatever iOS
    /// sends, only an /epinoia page opens here; anything else goes on to the Safari app.
    func openUniversalLink(_ url: URL) {
        guard Site.isEpinoia(url) else {
            if Site.isWeb(url) {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
            }
            return
        }
        if let web = web {
            web.load(url)
        } else {
            pendingLink = url
        }
    }

    func appDidBecomeActive() {
        web?.appDidBecomeActive()
    }
}
