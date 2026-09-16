import UIKit
import Capacitor

// Why this file exists
//   The iOS 27 SDK makes UIScene adoption mandatory. An app built against it that
//   declares no scene manifest traps at launch inside
//   __UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption — build 27 died
//   there on every launch, with no code change of ours behind it. Capacitor 8 ships
//   no scene delegate, so this is ours.
//
// What this file does NOT do
//   It never builds a window. The scene manifest names Main.storyboard as the
//   scene's UISceneStoryboardFile, so UIKit instantiates the storyboard's
//   CAPBridgeViewController, wraps it in a window and assigns it to `window` below
//   before willConnectTo is called — exactly what UIMainStoryboardFile used to do
//   for the app. Creating a second window here would blank the web view.
//
// What moved here from AppDelegate
//   Once scenes are adopted UIKit stops calling the app-level lifecycle, URL-open
//   and user-activity callbacks entirely, so the widget-snapshot mirroring, the
//   Capacitor URL handoff and the Spotlight result handling all have to be driven
//   from the scene. The logic itself still lives in AppDelegate as static methods;
//   this file only routes the scene's events to it.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    // A URL or a Spotlight tap that LAUNCHED the app is delivered in the connection
    // options, not through the callbacks below — those only fire for a scene that is
    // already connected. Missing this is why a cold Spotlight open silently does
    // nothing.
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        for activity in connectionOptions.userActivities {
            handle(activity)
        }
        open(connectionOptions.urlContexts)
    }

    func sceneWillResignActive(_ scene: UIScene) {
        AppDelegate.mirrorWidgetSnapshot()
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        AppDelegate.mirrorWidgetSnapshot()
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        open(URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        handle(userActivity)
    }

    // MARK: - Routing

    private func handle(_ userActivity: NSUserActivity) {
        // A Spotlight result is ours to consume; anything else (Universal Links)
        // belongs to Capacitor's plugins.
        if AppDelegate.handleSpotlightActivity(userActivity) { return }
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared, continue: userActivity, restorationHandler: { _ in }
        )
    }

    private func open(_ contexts: Set<UIOpenURLContext>) {
        for context in contexts {
            // UIScene.OpenURLOptions and UIApplication.OpenURLOptionsKey are separate
            // types; carry across the two fields Capacitor's plugins actually read.
            var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
            if let source = context.options.sourceApplication {
                options[.sourceApplication] = source
            }
            if let annotation = context.options.annotation {
                options[.annotation] = annotation
            }
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: options)
        }
    }
}
