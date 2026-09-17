import UIKit
import WebKit

/// THE WHOLE APP ON SCREEN: one full-screen WKWebView on https://prophesyscouting.co.uk/epinoia/.
///
/// The website does the work and changes without a new app. This controller adds only what a page
/// cannot do for itself inside iOS:
///
/// 1. SIGN-IN THAT LASTS. The default website data store is persistent, so cookies and
///    localStorage (the Supabase session) survive a relaunch.
/// 2. EDGE TO EDGE, IN THE PAGE'S COLOURS. The site uses viewport-fit=cover and
///    env(safe-area-inset-*), so the scroll view adds no insets of its own. Until the first paint
///    the web view is HOME's ground (#f3faf6), the launch screen's colour, so nothing flashes white.
///    After each load, and whenever the page changes it, <meta name="theme-color"> sets the ground
///    and the status bar's text colour.
/// 3. THE SITE STAYS IN THE APP, EVERYTHING ELSE LEAVES IT. /epinoia pages load here. The rest of
///    prophesyscouting.co.uk and every other site open in the Safari app, the App Store and
///    mailto:/tel:/sms: in their own apps, and epinoia://notification-settings opens this app's
///    page in Settings. NEVER AN IN-APP BROWSER (no SFSafariViewController): a browser inside the
///    app that can reach any site makes App Store Connect's "unrestricted web access" question a
///    yes, and that rates the app 17+.
/// 4. NATIVE DIALOGS AND DOWNLOADS. WKWebView shows nothing for alert(), confirm() or prompt()
///    unless the app draws them, and the site relies on confirm() and prompt(). A download is
///    saved to a temporary folder and offered to the share sheet (Save to Files, AirDrop, Mail).
/// 5. A SCREEN FOR FAILURE. A page that cannot load cannot say so, so a native "You're offline"
///    screen covers it until a load succeeds.
/// 6. THE BRIDGE (NativeBridge) and the notification routes (AppRouter).
final class WebViewController: UIViewController {

    private let initialURL: URL?
    private let contentController = WKUserContentController()
    private let bridge = NativeBridge()
    private let offlineView = OfflineView()
    private let pullToRefresh = UIRefreshControl()
    private var webView: WKWebView!

    private var statusBarStyle: UIStatusBarStyle = .darkContent
    private var themeObservation: NSKeyValueObservation?

    /// FALSE UNTIL iOS HAS SAID WHETHER NOTIFICATIONS ARE ALLOWED. The first page's
    /// window.EpinoiaNative.permission is baked in as it loads, and reading the status takes a few
    /// milliseconds, so the first load waits for it. A URL asked for meanwhile (a notification tap
    /// on a cold start) is kept in `queuedURL` and loaded instead of HOME.
    private var isReady = false
    private var queuedURL: URL?

    private var hasFinishedALoad = false
    /// The address that failed, so "Try again" retries that page rather than reloading the old one.
    private var failedURL: URL?
    /// The most recent load this controller started. A tapped notification's "opened" event waits
    /// for exactly this navigation to finish, so it reaches the new page and not the one leaving.
    private var latestLoad: WKNavigation?
    private var pendingOpenedPush: PushPayload?

    private var downloads: [ObjectIdentifier: URL] = [:]

    init(initialURL: URL?) {
        self.initialURL = initialURL
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("WebViewController is built in code")
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        statusBarStyle
    }

    // MARK: - Building the view

    override func loadView() {
        let root = UIView()
        root.backgroundColor = Site.ground

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = WKWebsiteDataStore.default()
        configuration.userContentController = contentController
        // KEEPS WEBKIT'S "Mobile/15E148" TOKEN (setting this property replaces it) and adds ours.
        // appmode.js recognises the app by EpinoiaApp-iOS/<build> before window.EpinoiaNative is
        // read, and server logs can tell app traffic from Safari's.
        configuration.applicationNameForUserAgent = "Mobile/15E148 EpinoiaApp-iOS/\(AppInfo.build)"
        // Like Safari on iPhone: <video playsinline> plays in the page, and only sound needs a tap.
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = .audio

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = Site.ground
        webView.scrollView.backgroundColor = Site.ground
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        #if DEBUG
        // Safari's Web Inspector (Develop menu) for builds run from Xcode only, never the store build.
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif
        webView.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(webView)

        pullToRefresh.addTarget(self, action: #selector(pulledToRefresh), for: .valueChanged)
        webView.scrollView.refreshControl = pullToRefresh

        offlineView.isHidden = true
        offlineView.translatesAutoresizingMaskIntoConstraints = false
        offlineView.onRetry = { [weak self] in
            self?.retry()
        }
        root.addSubview(offlineView)

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: root.topAnchor),
            webView.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            offlineView.topAnchor.constraint(equalTo: root.topAnchor),
            offlineView.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            offlineView.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            offlineView.trailingAnchor.constraint(equalTo: root.trailingAnchor)
        ])

        self.webView = webView
        view = root
        bridge.attach(to: webView, contentController: contentController)
    }

    override func viewDidLoad() {
        super.viewDidLoad()

        // THE THEME COLOUR, LIVE. WKWebView.themeColor follows <meta name="theme-color">, so the
        // site's light/dark switch (which rewrites the meta without a new load) recolours the
        // status bar at once. The KVO callback is not known to the compiler to run on the main
        // actor, hence the hop.
        themeObservation = webView.observe(\WKWebView.themeColor, options: []) { [weak self] _, _ in
            guard let controller = self else { return }
            Task { @MainActor in
                controller.applyTheme(controller.webView.themeColor)
            }
        }

        AppRouter.shared.attach(self)

        Task { @MainActor in
            await Push.shared.refreshStatus()
            self.isReady = true
            let first = self.queuedURL ?? self.initialURL ?? Site.startURL
            self.queuedURL = nil
            self.load(first)
        }
    }

    // MARK: - Loading

    /// Every load the app starts goes through here, and so through the navigation policy.
    func load(_ url: URL) {
        guard isReady else {
            queuedURL = url
            return
        }
        latestLoad = webView.load(URLRequest(url: url))
    }

    @objc private func pulledToRefresh() {
        if webView.url != nil, let navigation = webView.reload() {
            latestLoad = navigation
        } else {
            pullToRefresh.endRefreshing()
            load(initialURL ?? Site.startURL)
        }
    }

    /// "Try again": the page that failed if known, else a reload, else the first page.
    private func retry() {
        if let url = failedURL, Site.isWeb(url) {
            load(url)
        } else if hasFinishedALoad, webView.url != nil, let navigation = webView.reload() {
            latestLoad = navigation
        } else {
            load(initialURL ?? Site.startURL)
        }
    }

    // MARK: - From AppRouter

    func appDidBecomeActive() {
        bridge.appDidBecomeActive()
    }

    /// Shown while the app is open (iOS still shows the banner): the page hears about it at once.
    func notificationPresented(_ payload: PushPayload) {
        bridge.sendPush(payload, opened: false)
    }

    /// TAPPED. An /epinoia page loads here and hears "opened" once it has loaded (the page on
    /// screen now is about to go). Anything else opens in Safari and the page that stays hears now.
    func notificationTapped(_ payload: PushPayload) {
        guard let url = payload.url else {
            bridge.sendPush(payload, opened: true)
            return
        }
        if Site.isEpinoia(url) {
            pendingOpenedPush = payload
            load(url)
        } else {
            openOutside(url)
            bridge.sendPush(payload, opened: true)
        }
    }

    // MARK: - Theme

    private static let themeColorScript =
        "(function () { var m = document.querySelector('meta[name=theme-color]'); return m ? String(m.content || '') : ''; })()"

    private func readThemeColor() {
        webView.evaluateJavaScript(WebViewController.themeColorScript) { [weak self] result, _ in
            let hex = result as? String
            guard let controller = self else { return }
            Task { @MainActor in
                controller.applyTheme(hex.flatMap { UIColor(cssHex: $0) })
            }
        }
    }

    /// The page's colour behind the web view (seen on overscroll) and a status bar that reads on
    /// it: dark text on light colours, light text on dark ones. nil (no meta) changes nothing.
    private func applyTheme(_ color: UIColor?) {
        guard let color = color else { return }
        view.backgroundColor = color
        webView.backgroundColor = color
        webView.scrollView.backgroundColor = color
        let style: UIStatusBarStyle = color.isLightForStatusBar ? .darkContent : .lightContent
        if style != statusBarStyle {
            statusBarStyle = style
            setNeedsStatusBarAppearanceUpdate()
        }
    }

    // MARK: - Presenting

    /// The controller that can present right now: the top of the modal stack, or nil when this
    /// view is not on screen. JavaScript dialogs must always call their completion handler (WebKit
    /// raises an exception otherwise), so a nil here answers them at once instead.
    private func topPresenter() -> UIViewController? {
        guard isViewLoaded, view.window != nil else { return nil }
        var top: UIViewController = self
        while let presented = top.presentedViewController, !presented.isBeingDismissed {
            top = presented
        }
        return top
    }

    /// LEAVING THE APP: the Safari app (or the app that claims the address as its own universal
    /// link, e.g. the App Store for apps.apple.com). See point 3 above for why never in-app.
    private func openOutside(_ url: URL) {
        guard Site.isWeb(url) else { return }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    private func showMessage(title: String, message: String) {
        guard let presenter = topPresenter() else { return }
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        presenter.present(alert, animated: true)
    }
}

// MARK: - Navigation policy and page lifecycle

extension WebViewController: WKNavigationDelegate {

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        let scheme = url.scheme?.lowercased() ?? ""

        // This app's own links. Only notification-settings exists; any other is ignored.
        if scheme == "epinoia" {
            decisionHandler(.cancel)
            if Site.isNotificationSettingsLink(url) {
                _ = NativeBridge.openNotificationSettings()
            }
            return
        }

        // Pages the web view makes itself.
        if scheme == "about" || scheme == "blob" || scheme == "data" {
            decisionHandler(.allow)
            return
        }

        // Mail, Phone, Messages and the App Store, from any frame: a frame cannot show them anyway.
        if Site.isSystemLink(url) || scheme == "itms-apps" || scheme == "itms-appss" {
            decisionHandler(.cancel)
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
            return
        }

        // EMBEDDED FRAMES LOAD WHATEVER THEY LOAD (video players, maps): they never replace the page.
        let targetFrame = navigationAction.targetFrame
        if let frame = targetFrame, !frame.isMainFrame {
            decisionHandler(.allow)
            return
        }

        // The App Store listing (the site's "update the app" button) opens the App Store app.
        if Site.isAppStore(url) {
            decisionHandler(.cancel)
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
            return
        }

        // A NEW WINDOW (target=_blank, window.open): allowed here so WebKit asks
        // createWebViewWith, which decides where it goes.
        if targetFrame == nil {
            decisionHandler(Site.isWeb(url) ? .allow : .cancel)
            return
        }

        guard Site.isWeb(url) else {
            // Another app's scheme. A tapped link hands it to iOS; left to WebKit it would fail
            // as "unsupported URL" and bring up the offline screen.
            decisionHandler(.cancel)
            if navigationAction.navigationType == .linkActivated {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
            }
            return
        }

        // http://prophesyscouting.co.uk is this site without TLS (GitHub Pages redirects it):
        // load the https address here rather than sending a plain link out to Safari.
        if scheme == "http", Site.isOurHost(url),
           var secure = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            secure.scheme = "https"
            secure.port = nil
            if let secureURL = secure.url {
                decisionHandler(.cancel)
                load(secureURL)
                return
            }
        }

        if Site.isEpinoia(url) {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
            openOutside(url)
        }
    }

    /// A response the web view cannot show (a PDF it can show; a CSV or ZIP it cannot), or one the
    /// server marks as an attachment, becomes a download.
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if !navigationResponse.canShowMIMEType {
            decisionHandler(.download)
            return
        }
        if let http = navigationResponse.response as? HTTPURLResponse,
           let disposition = http.value(forHTTPHeaderField: "Content-Disposition"),
           disposition.lowercased().hasPrefix("attachment") {
            decisionHandler(.download)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        bridge.pageDidCommit()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        hasFinishedALoad = true
        failedURL = nil
        offlineView.setRetrying(false)
        offlineView.isHidden = true
        pullToRefresh.endRefreshing()
        readThemeColor()

        if let payload = pendingOpenedPush, latestLoad == nil || navigation === latestLoad {
            pendingOpenedPush = nil
            bridge.sendPush(payload, opened: true)
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        loadFailed(navigation, error: error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        loadFailed(navigation, error: error)
    }

    /// THE WEB CONTENT PROCESS WAS KILLED (memory pressure while in the background, usually):
    /// the web view is left blank, so load the page again.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if webView.url != nil, let navigation = webView.reload() {
            latestLoad = navigation
        } else {
            load(initialURL ?? Site.startURL)
        }
    }

    /// NOT EVERY FAILURE IS A FAILURE. Cancelled (-999: a new navigation replaced this one, or the
    /// policy cancelled it) and WebKit's 102 (frame load interrupted: the load became a download,
    /// or went to Safari) and 204 (a media file handed to the player) all mean the web view did
    /// what it was told. Anything else shows the offline screen over the page.
    private func loadFailed(_ navigation: WKNavigation?, error: Error) {
        pullToRefresh.endRefreshing()
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
        if nsError.domain == "WebKitErrorDomain" && (nsError.code == 102 || nsError.code == 204) { return }

        if let failed = nsError.userInfo[NSURLErrorFailingURLErrorKey] as? URL {
            failedURL = failed
        }
        // The notification's page did not load: its "opened" event goes with the next page that does.
        if navigation === latestLoad {
            latestLoad = nil
        }
        offlineView.setRetrying(false)
        offlineView.isHidden = false
    }
}

// MARK: - New windows, JavaScript dialogs, camera

extension WebViewController: WKUIDelegate {

    /// target=_blank and window.open. The app has one web view: an /epinoia page replaces the
    /// current one (Back returns), anything else goes to Safari. Returning nil opens no window.
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        if Site.isEpinoia(url) {
            load(url)
        } else if Site.isAppStore(url) || Site.isSystemLink(url) {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        } else if Site.isWeb(url) {
            openOutside(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        guard let presenter = topPresenter() else {
            completionHandler()
            return
        }
        let alert = UIAlertController(title: "EPINOIΛ", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
            completionHandler()
        })
        presenter.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        guard let presenter = topPresenter() else {
            completionHandler(false)
            return
        }
        let alert = UIAlertController(title: "EPINOIΛ", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in
            completionHandler(false)
        })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
            completionHandler(true)
        })
        presenter.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        guard let presenter = topPresenter() else {
            completionHandler(nil)
            return
        }
        let alert = UIAlertController(title: "EPINOIΛ", message: prompt, preferredStyle: .alert)
        alert.addTextField { field in
            field.text = defaultText
        }
        let field = alert.textFields?.first
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in
            completionHandler(nil)
        })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
            completionHandler(field?.text ?? "")
        })
        presenter.present(alert, animated: true)
    }

    /// THE CAMERA, FOR THIS SITE ONLY (photo uploads, the scoreboard clock reader). WebKit then
    /// asks the person itself. The microphone is always refused: the app declares no
    /// NSMicrophoneUsageDescription, and nothing on the site records sound.
    func webView(_ webView: WKWebView,
                 requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        guard Site.isOurSecurityOrigin(origin) else {
            decisionHandler(.deny)
            return
        }
        switch type {
        case .camera:
            decisionHandler(.prompt)
        default:
            decisionHandler(.deny)
        }
    }
}

// MARK: - Downloads

extension WebViewController: WKDownloadDelegate {

    /// EACH DOWNLOAD GETS ITS OWN NEW FOLDER in the app's temporary directory: WebKit fails a
    /// download whose destination already exists, and the suggested name is kept as it is, so the
    /// file shared is "fixtures.csv", not a generated name. iOS empties tmp/ itself; the files are
    /// not deleted when the share sheet closes, because Save to Files may still be copying.
    func download(_ download: WKDownload,
                  decideDestinationUsing response: URLResponse,
                  suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("Downloads", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: nil)
        } catch {
            completionHandler(nil)   // nil cancels the download
            return
        }
        let destination = folder.appendingPathComponent(WebViewController.safeFilename(suggestedFilename),
                                                        isDirectory: false)
        downloads[ObjectIdentifier(download)] = destination
        completionHandler(destination)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let file = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
        guard let presenter = topPresenter() else { return }
        let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = view
        presenter.present(sheet, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.removeValue(forKey: ObjectIdentifier(download))
        showMessage(title: "Download failed", message: error.localizedDescription)
    }

    /// A file name, never a path: no slashes or colons, never empty.
    private static func safeFilename(_ suggested: String) -> String {
        let cleaned = suggested
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.isEmpty || cleaned == "." || cleaned == ".." {
            return "download"
        }
        return cleaned
    }
}
