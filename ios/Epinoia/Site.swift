import UIKit
import WebKit

/// THE ONE PLACE THAT KNOWS WHICH ADDRESSES ARE EPINOIA'S.
///
/// The app is a window on https://prophesyscouting.co.uk/epinoia/. Every decision about a URL
/// (show it here, hand it to the Safari app, trust a message from it) asks this file, so the host is
/// written once. The apex only, never www: www 301-redirects to the apex, and a page that stayed on
/// www would be a different origin to WebKit, to the bridge and to the sign-in cookies.
enum Site {
    static let host = "prophesyscouting.co.uk"
    static let origin = "https://prophesyscouting.co.uk"

    /// HOME, marked ?source=ios like the Android app's ?source=twa.
    static let defaultStartURL = URL(string: "https://prophesyscouting.co.uk/epinoia/home/?source=ios")!

    /// THE KIT'S LIGHT TOKENS (epinoia/kit/epinoia-kit.css, as android/.../values/colors.xml copies
    /// them). The ground, #f3faf6, is HOME's colour: the launch screen, the web view before its
    /// first paint and the offline screen all use it, so nothing flashes white between them.
    static let ground = UIColor(red: 0xF3 / 255.0, green: 0xFA / 255.0, blue: 0xF6 / 255.0, alpha: 1)
    static let ink = UIColor(red: 0x0D / 255.0, green: 0x1F / 255.0, blue: 0x17 / 255.0, alpha: 1)
    static let ink2 = UIColor(red: 0x0D / 255.0, green: 0x1F / 255.0, blue: 0x17 / 255.0, alpha: 0.82)
    static let lume = UIColor(red: 0x0C / 255.0, green: 0x7A / 255.0, blue: 0x54 / 255.0, alpha: 1)

    /// WHERE THE APP OPENS. Normally HOME. CI's screenshots pass another page as a launch argument:
    ///   xcrun simctl launch <udid> uk.co.prophesyscouting.epinoia -EpinoiaStartURL <url>
    /// A "-Key value" launch argument lands in UserDefaults' argument domain, for that launch only.
    /// Only a page on this origin is accepted, so the argument cannot make the app a browser.
    static var startURL: URL {
        if let text = UserDefaults.standard.string(forKey: "EpinoiaStartURL"),
           let url = URL(string: text),
           isOurOrigin(url) {
            return url
        }
        return defaultStartURL
    }

    /// https, exactly this host, the default port.
    static func isOurOrigin(_ url: URL?) -> Bool {
        guard let url = url,
              url.scheme?.lowercased() == "https",
              url.host?.lowercased() == host else { return false }
        return url.port == nil || url.port == 443
    }

    /// Our origin AND inside /epinoia. The same test as appmode.js's /^\/epinoia(\/|$)/: the rest
    /// of prophesyscouting.co.uk (the scouting tools) is a different product and opens in Safari.
    static func isEpinoia(_ url: URL?) -> Bool {
        guard let url = url, isOurOrigin(url) else { return false }
        let path = url.path
        return path == "/epinoia" || path.hasPrefix("/epinoia/")
    }

    /// The host alone, any scheme. A notification's url is loaded in the web view on this test and
    /// the navigation policy then decides, exactly as for a tapped link.
    static func isOurHost(_ url: URL?) -> Bool {
        url?.host?.lowercased() == host
    }

    /// http or https: a web page, which leaves the app for the Safari app.
    static func isWeb(_ url: URL?) -> Bool {
        let scheme = url?.scheme?.lowercased()
        return scheme == "http" || scheme == "https"
    }

    /// THE APP STORE OPENS AS THE APP STORE. The site's "update the app" button points at the
    /// apps.apple.com listing, which UIApplication.open hands to the App Store app. Named on its
    /// own (not just "a web page") so an itms-apps: link, which is not http, is caught too.
    static func isAppStore(_ url: URL?) -> Bool {
        guard let url = url, let scheme = url.scheme?.lowercased() else { return false }
        if scheme == "itms-apps" || scheme == "itms-appss" { return true }
        return isWeb(url) && url.host?.lowercased() == "apps.apple.com"
    }

    /// Links the phone's own apps handle: Mail, Phone, Messages.
    static func isSystemLink(_ url: URL?) -> Bool {
        let scheme = url?.scheme?.lowercased()
        return scheme == "mailto" || scheme == "tel" || scheme == "sms"
    }

    /// epinoia://notification-settings, the link the site shows inside the app. Android's
    /// equivalent is the intent:// URL in android/README.md; here the web view never loads it,
    /// the navigation policy catches it.
    static func isNotificationSettingsLink(_ url: URL?) -> Bool {
        url?.scheme?.lowercased() == "epinoia" && url?.host?.lowercased() == "notification-settings"
    }

    /// A security origin as WebKit reports it for a frame, a script message or a camera request.
    /// port is 0 when the URL named none. WebKit's classes are main-actor types, hence @MainActor.
    @MainActor
    static func isOurSecurityOrigin(_ origin: WKSecurityOrigin) -> Bool {
        origin.`protocol`.lowercased() == "https"
            && origin.host.lowercased() == host
            && (origin.port == 0 || origin.port == 443)
    }
}

/// THIS BUILD, AS INFO.PLIST SAYS. CI sets both from epinoia/ios/version.json through
/// MARKETING_VERSION and CURRENT_PROJECT_VERSION, so these are what the App Store sees too.
enum AppInfo {
    /// CFBundleVersion as a number: version.json's "build". The site compares it with minShell.
    static var build: Int {
        Int((Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String) ?? "") ?? 0
    }

    /// CFBundleShortVersionString: version.json's "version", e.g. 1.0.0.
    static var version: String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0.0.0"
    }
}

/// WHAT A NOTIFICATION CARRIES FOR THE APP, read once where iOS hands it over. The server puts
/// url, tag and kind at the top level beside "aps" (supabase/functions/_shared/apns.js).
/// Plain values only, so it can cross from UserNotifications' callbacks to the main actor.
struct PushPayload: Sendable {
    let url: URL?
    let tag: String?
    let kind: String?
    /// When the app saw it (shown or tapped), in milliseconds since 1970, like the site's Date.now().
    let at: Int64

    init(userInfo: [AnyHashable: Any], seenAt date: Date = Date()) {
        url = PushPayload.text(userInfo["url"]).flatMap { URL(string: $0) }
        tag = PushPayload.text(userInfo["tag"])
        kind = PushPayload.text(userInfo["kind"])
        at = Int64((date.timeIntervalSince1970 * 1000).rounded())
    }

    private static func text(_ value: Any?) -> String? {
        if let string = value as? String { return string }
        if let number = value as? NSNumber { return number.stringValue }
        return nil
    }
}

/// A string for JSON, or JSON's null. Written out rather than `value ?? NSNull()`, which needs the
/// type checker to find a common type for String and NSNull inside large dictionary literals.
func jsonStringOrNull(_ value: String?) -> Any {
    if let value = value {
        return value
    }
    return NSNull()
}

extension UIColor {
    /// A CSS hex colour, #rgb or #rrggbb, as <meta name="theme-color"> carries it. Anything else
    /// (rgb(), a colour name) is nil and leaves the current colour alone.
    convenience init?(cssHex: String) {
        var hex = cssHex.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard hex.hasPrefix("#") else { return nil }
        hex.removeFirst()
        if hex.count == 3 {
            hex = hex.map { "\($0)\($0)" }.joined()
        }
        guard hex.count == 6, let value = UInt32(hex, radix: 16) else { return nil }
        self.init(red: CGFloat((value >> 16) & 0xFF) / 255.0,
                  green: CGFloat((value >> 8) & 0xFF) / 255.0,
                  blue: CGFloat(value & 0xFF) / 255.0,
                  alpha: 1)
    }

    /// Light enough for dark status-bar text. Perceived brightness (Rec. 601 weights): HOME's
    /// #f3faf6 is about 0.97, the dark theme's #04100b about 0.05.
    var isLightForStatusBar: Bool {
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
        guard getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return true }
        return 0.299 * red + 0.587 * green + 0.114 * blue > 0.5
    }
}
