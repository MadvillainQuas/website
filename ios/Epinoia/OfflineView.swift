import UIKit

/// THE SCREEN FOR "THE PAGE COULD NOT LOAD", native because a page that failed to load cannot say
/// so itself. Without it a failed first launch would be a blank mint screen with nothing to tap.
///
/// Drawn in HOME's light colours, like the launch screen it usually follows. The web view shows it
/// on a failed main-frame load and hides it on the next finished one; "Try again" asks the web view
/// to load again and shows a spinner until the answer comes back either way.
final class OfflineView: UIView {
    /// Set by WebViewController.
    var onRetry: (() -> Void)?

    private let button = UIButton(type: .system)

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = Site.ground

        let title = UILabel()
        title.text = "You're offline"
        title.textColor = Site.ink
        title.font = UIFontMetrics(forTextStyle: .title2).scaledFont(for: UIFont.systemFont(ofSize: 22, weight: .bold))
        title.adjustsFontForContentSizeCategory = true
        title.textAlignment = .center
        title.numberOfLines = 0
        title.accessibilityTraits.insert(.header)

        let body = UILabel()
        body.text = "EPINOIΛ needs a connection. Check it and try again."
        body.textColor = Site.ink2
        body.font = UIFont.preferredFont(forTextStyle: .body)
        body.adjustsFontForContentSizeCategory = true
        body.textAlignment = .center
        body.numberOfLines = 0

        var configuration = UIButton.Configuration.filled()
        configuration.title = "Try again"
        configuration.baseBackgroundColor = Site.lume
        configuration.baseForegroundColor = .white
        configuration.cornerStyle = .capsule
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 14, leading: 28, bottom: 14, trailing: 28)
        button.configuration = configuration
        // Target-action rather than a UIAction closure: the method is plainly on the main actor.
        button.addTarget(self, action: #selector(retryTapped), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [title, body, button])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 12
        stack.setCustomSpacing(28, after: body)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        // 360 pt wide where there is room, otherwise the width between 28 pt margins. The
        // preferred width outranks the labels' compression resistance (750), so a long line wraps
        // instead of widening the column.
        let guide = safeAreaLayoutGuide
        let preferredWidth = stack.widthAnchor.constraint(equalToConstant: 360)
        preferredWidth.priority = UILayoutPriority(760)
        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: guide.centerYAnchor),
            stack.centerXAnchor.constraint(equalTo: guide.centerXAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: guide.leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: guide.trailingAnchor, constant: -28),
            preferredWidth,
            title.widthAnchor.constraint(equalTo: stack.widthAnchor),
            body.widthAnchor.constraint(equalTo: stack.widthAnchor)
        ])
    }

    required init?(coder: NSCoder) {
        fatalError("OfflineView is built in code")
    }

    /// While a retry is loading: a spinner in the button, and no second tap.
    func setRetrying(_ retrying: Bool) {
        button.isEnabled = !retrying
        button.configuration?.showsActivityIndicator = retrying
    }

    @objc private func retryTapped() {
        setRetrying(true)
        onRetry?()
    }
}
