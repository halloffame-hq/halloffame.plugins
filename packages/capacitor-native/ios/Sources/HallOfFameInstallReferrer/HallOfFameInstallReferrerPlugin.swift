import Capacitor
import Foundation

/// The App Store passes no referrer to an installed app, so there is never one to report.
@objc(HallOfFameInstallReferrerPlugin)
public class HallOfFameInstallReferrerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HallOfFameInstallReferrerPlugin"
    public let jsName = "HallOfFameInstallReferrer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
    ]

    @objc func get(_ call: CAPPluginCall) {
        call.resolve(["referrer": NSNull(), "clickedAt": NSNull(), "installedAt": NSNull()])
    }
}
