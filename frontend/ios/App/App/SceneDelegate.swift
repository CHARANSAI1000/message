import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    /// Privacy cover shown in the app switcher and while the screen is being recorded or mirrored.
    private var privacyCover: UIView?
    private var captureObserver: NSObjectProtocol?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = CAPBridgeViewController()
        window?.makeKeyAndVisible()

        // iOS doesn't let apps block screenshots, but it does tell us when the screen is being
        // recorded/mirrored — hide the conversation while that's happening.
        captureObserver = NotificationCenter.default.addObserver(
            forName: UIScreen.capturedDidChangeNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.updateCaptureCover() }
        updateCaptureCover()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func sceneWillResignActive(_ scene: UIScene) {
        showCover()  // the app-switcher snapshot shows the cover, not your chats
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        updateCaptureCover()
    }

    private func updateCaptureCover() {
        if window?.windowScene?.screen.isCaptured == true { showCover() } else { hideCover() }
    }

    private func showCover() {
        guard privacyCover == nil, let window = window else { return }
        let cover = UIVisualEffectView(effect: UIBlurEffect(style: .systemThickMaterial))
        cover.frame = window.bounds
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        let label = UILabel()
        label.text = "ForYou"
        label.font = .systemFont(ofSize: 28, weight: .bold)
        label.translatesAutoresizingMaskIntoConstraints = false
        cover.contentView.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: cover.contentView.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: cover.contentView.centerYAnchor),
        ])
        window.addSubview(cover)
        privacyCover = cover
    }

    private func hideCover() {
        privacyCover?.removeFromSuperview()
        privacyCover = nil
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
