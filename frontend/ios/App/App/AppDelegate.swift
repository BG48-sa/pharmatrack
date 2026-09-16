import UIKit
import Capacitor
import WidgetKit
import CoreSpotlight

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    // No `window` property here any more: under the UIScene lifecycle the scene owns
    // the window, and Main.storyboard is attached to the scene rather than to the
    // app. UIKit also stops calling the app-level lifecycle, URL-open and
    // user-activity callbacks once scenes are adopted, so those moved to
    // SceneDelegate.swift; what stays here is the logic they share, as statics.

    // Widget bridge: Capacitor Preferences writes to UserDefaults.standard with a
    // "CapacitorStorage." prefix, which app extensions cannot read. The web app
    // maintains a JSON snapshot of upcoming EU decisions for followed indications
    // under the Preferences key `dr_widget_snapshot`; we mirror it into the shared
    // App Group here so the DrugRadarWidget extension can render it. The snapshot
    // can only change while the app is in use, so mirroring on launch and on
    // resign-active/background covers every update.
    private static let appGroupId = "group.com.berndgansbacher.pharmatrack"

    static func mirrorWidgetSnapshot() {
        guard let group = UserDefaults(suiteName: appGroupId) else { return }
        let snapshot = UserDefaults.standard.string(forKey: "CapacitorStorage.dr_widget_snapshot")
        if group.string(forKey: "widget_snapshot") == snapshot { return }
        group.set(snapshot, forKey: "widget_snapshot")
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    /// A Spotlight result was tapped: hand the drug name to the web app via a
    /// Preferences key it checks on mount and on foreground (visibilitychange).
    /// Returns true when the activity was ours, so the caller knows not to pass it
    /// on to Capacitor.
    static func handleSpotlightActivity(_ userActivity: NSUserActivity) -> Bool {
        guard userActivity.activityType == CSSearchableItemActionType,
              let id = userActivity.userInfo?[CSSearchableItemActivityIdentifier] as? String,
              id.hasPrefix(SpotlightIndexer.idPrefix) else {
            return false
        }
        let name = String(id.dropFirst(SpotlightIndexer.idPrefix.count))
        let payload = ["name": name, "ts": ISO8601DateFormatter().string(from: Date())]
        if let json = try? JSONSerialization.data(withJSONObject: payload),
           let str = String(data: json, encoding: .utf8) {
            UserDefaults.standard.set(str, forKey: "CapacitorStorage.dr_spotlight_open")
        }
        return true
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Still called with scenes adopted, and still the right place for work that
        // is per-process rather than per-window.
        AppDelegate.mirrorWidgetSnapshot()
        SpotlightIndexer.indexIfNeeded()
        return true
    }

    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        // Hands back the single configuration declared in Info.plist's
        // UIApplicationSceneManifest ("Default Configuration").
        UISceneConfiguration(name: connectingSceneSession.configuration.name, sessionRole: connectingSceneSession.role)
    }

}
