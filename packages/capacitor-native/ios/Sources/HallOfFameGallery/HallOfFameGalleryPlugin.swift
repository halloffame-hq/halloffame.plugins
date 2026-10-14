import Capacitor
import Foundation
import Photos
import PhotosUI

/// Reads the device's own images and videos for the in-app gallery.
@objc(HallOfFameGalleryPlugin)
public class HallOfFameGalleryPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HallOfFameGalleryPlugin"
    public let jsName = "HallOfFameGallery"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "manageAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "file", returnType: CAPPluginReturnPromise),
    ]

    private let library = MediaLibrary()
    private let worker = DispatchQueue(label: "hallofame.gallery", qos: .userInitiated)

    @objc func checkAccess(_ call: CAPPluginCall) {
        call.resolve(["access": access()])
    }

    @objc func requestAccess(_ call: CAPPluginCall) {
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { _ in
            call.resolve(["access": self.access()])
        }
    }

    @objc func manageAccess(_ call: CAPPluginCall) {
        guard PHPhotoLibrary.authorizationStatus(for: .readWrite) == .limited else {
            requestAccess(call)
            return
        }

        DispatchQueue.main.async {
            guard let controller = self.bridge?.viewController else {
                call.resolve(["access": self.access()])
                return
            }

            PHPhotoLibrary.shared().presentLimitedLibraryPicker(from: controller) { _ in
                call.resolve(["access": self.access()])
            }
        }
    }

    @objc func list(_ call: CAPPluginCall) {
        let current = access()
        guard current == "granted" || current == "limited" else {
            call.reject("Allow access to photos and videos first.", "ACCESS_DENIED")
            return
        }

        let requested = call.getArray("types", String.self) ?? ["image", "video"]
        let types = requested.compactMap { type -> PHAssetMediaType? in
            switch type {
            case "image": return .image
            case "video": return .video
            default: return nil
            }
        }
        guard !types.isEmpty else {
            call.reject("`types` must list image and/or video.")
            return
        }

        let offset = max(0, call.getInt("offset") ?? 0)
        let limit = max(1, min(120, call.getInt("limit") ?? 60))
        let size = CGFloat(max(64, min(1024, call.getInt("thumbnailSize") ?? 320)))

        worker.async {
            call.resolve(self.library.page(offset: offset, limit: limit, types: types, thumbnailSize: size))
        }
    }

    @objc func file(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), !id.isEmpty else {
            call.reject("`id` must be a gallery item id.")
            return
        }

        worker.async {
            self.library.file(id: id) { result in
                switch result {
                case .success(let file): call.resolve(file)
                case .failure(let failure): call.reject(failure.message)
                }
            }
        }
    }

    private func access() -> String {
        switch PHPhotoLibrary.authorizationStatus(for: .readWrite) {
        case .authorized: return "granted"
        case .limited: return "limited"
        case .notDetermined: return "prompt"
        default: return "denied"
        }
    }
}
