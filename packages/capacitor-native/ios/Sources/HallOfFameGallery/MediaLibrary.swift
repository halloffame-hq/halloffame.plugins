import Foundation
import Photos
import UIKit
import UniformTypeIdentifiers

/// The device's images and videos, newest first, read through PhotoKit.
final class MediaLibrary {
    struct Failure: Error {
        let message: String
    }

    private let images = PHImageManager.default()
    private let isoDates = ISO8601DateFormatter()

    /// One page of items, with `hasMore` when another page follows.
    func page(offset: Int, limit: Int, types: [PHAssetMediaType], thumbnailSize: CGFloat) -> [String: Any] {
        let options = PHFetchOptions()
        options.predicate = NSPredicate(format: "mediaType IN %@", types.map { $0.rawValue })
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]

        let assets = PHAsset.fetchAssets(with: options)
        let end = min(assets.count, offset + limit)
        var items: [[String: Any]] = []

        if offset < end {
            for index in offset..<end {
                items.append(item(assets.object(at: index), thumbnailSize: thumbnailSize))
            }
        }

        return ["items": items, "hasMore": end < assets.count]
    }

    /// Copies the asset into a temporary file the WebView can read.
    func file(id: String, completion: @escaping (Result<[String: Any], Failure>) -> Void) {
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else {
            completion(.failure(Failure(message: "That item is no longer on this device.")))
            return
        }

        if asset.mediaType == .video {
            exportVideo(asset, completion: completion)
        } else {
            exportImage(asset, completion: completion)
        }
    }

    private func item(_ asset: PHAsset, thumbnailSize: CGFloat) -> [String: Any] {
        let resource = primaryResource(of: asset)
        let video = asset.mediaType == .video
        var item: [String: Any] = [
            "id": asset.localIdentifier,
            "type": video ? "video" : "image",
            "mimeType": mimeType(of: resource, video: video),
            "name": resource?.originalFilename ?? "media",
            "width": asset.pixelWidth,
            "height": asset.pixelHeight,
            "createdAt": isoDates.string(from: asset.creationDate ?? Date()),
            "thumbnail": thumbnail(of: asset, size: thumbnailSize),
        ]
        if video { item["duration"] = asset.duration }

        return item
    }

    private func thumbnail(of asset: PHAsset, size: CGFloat) -> String {
        let options = PHImageRequestOptions()
        options.isSynchronous = true
        options.deliveryMode = .opportunistic
        options.resizeMode = .fast
        options.isNetworkAccessAllowed = true

        var encoded = ""
        images.requestImage(
            for: asset,
            targetSize: CGSize(width: size, height: size),
            contentMode: .aspectFill,
            options: options
        ) { image, _ in
            if let data = image?.jpegData(compressionQuality: 0.7) {
                encoded = data.base64EncodedString()
            }
        }

        return encoded
    }

    private func exportImage(_ asset: PHAsset, completion: @escaping (Result<[String: Any], Failure>) -> Void) {
        let options = PHImageRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.isNetworkAccessAllowed = true
        options.version = .current

        let original = primaryResource(of: asset)?.originalFilename ?? "photo"
        images.requestImageDataAndOrientation(for: asset, options: options) { data, uti, _, _ in
            guard var data else {
                completion(.failure(Failure(message: "That photo could not be read.")))
                return
            }

            var type = uti.flatMap { UTType($0) } ?? .jpeg
            // Browsers and the upload pipeline read JPEG and PNG everywhere; HEIC is converted.
            if !(type.conforms(to: .jpeg) || type.conforms(to: .png) || type.conforms(to: .gif)) {
                guard let jpeg = UIImage(data: data)?.jpegData(compressionQuality: 0.9) else {
                    completion(.failure(Failure(message: "That photo could not be converted.")))
                    return
                }
                data = jpeg
                type = .jpeg
            }

            let name = self.renamed(original, to: type)
            do {
                let url = try self.temporaryURL(named: name)
                try data.write(to: url)
                completion(.success(self.described(url, name: name, type: type)))
            } catch {
                completion(.failure(Failure(message: "That photo could not be saved for upload.")))
            }
        }
    }

    private func exportVideo(_ asset: PHAsset, completion: @escaping (Result<[String: Any], Failure>) -> Void) {
        let resources = PHAssetResource.assetResources(for: asset)
        guard let resource = resources.first(where: { $0.type == .fullSizeVideo })
            ?? resources.first(where: { $0.type == .video }) else {
            completion(.failure(Failure(message: "That video could not be read.")))
            return
        }

        let options = PHAssetResourceRequestOptions()
        options.isNetworkAccessAllowed = true

        do {
            let url = try temporaryURL(named: resource.originalFilename)
            PHAssetResourceManager.default().writeData(for: resource, toFile: url, options: options) { error in
                if error != nil {
                    completion(.failure(Failure(message: "That video could not be saved for upload.")))
                    return
                }

                let type = UTType(resource.uniformTypeIdentifier) ?? .movie
                completion(.success(self.described(url, name: resource.originalFilename, type: type)))
            }
        } catch {
            completion(.failure(Failure(message: "That video could not be saved for upload.")))
        }
    }

    private func primaryResource(of asset: PHAsset) -> PHAssetResource? {
        let resources = PHAssetResource.assetResources(for: asset)
        let preferred: [PHAssetResourceType] = asset.mediaType == .video ? [.video, .fullSizeVideo] : [.photo, .fullSizePhoto]

        return resources.first { preferred.contains($0.type) } ?? resources.first
    }

    private func mimeType(of resource: PHAssetResource?, video: Bool) -> String {
        resource.flatMap { UTType($0.uniformTypeIdentifier)?.preferredMIMEType } ?? (video ? "video/quicktime" : "image/jpeg")
    }

    private func renamed(_ name: String, to type: UTType) -> String {
        guard let ext = type.preferredFilenameExtension else { return name }

        return (name as NSString).deletingPathExtension + "." + ext
    }

    /// A fresh, uniquely named file in a directory of its own, so original names never collide.
    private func temporaryURL(named name: String) throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("hallofame-gallery", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        return directory.appendingPathComponent(name)
    }

    private func described(_ url: URL, name: String, type: UTType) -> [String: Any] {
        ["path": url.absoluteString, "mimeType": type.preferredMIMEType ?? "application/octet-stream", "name": name]
    }
}
