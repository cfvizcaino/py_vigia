import ExpoModulesCore
import Foundation
import UIKit

public final class VigiaCameraServerModule: Module {
  private var server: MjpegHttpServer?

  public func definition() -> ModuleDefinition {
    Name("VigiaCameraServer")

    AsyncFunction("start") { (host: String, port: Int, accessKey: String?) throws -> String in
      if let server = self.server, server.isRunning {
        return host
      }
      let next = MjpegHttpServer(host: host, port: port, accessKey: accessKey)
      try next.start()
      self.server = next
      return host
    }

    AsyncFunction("publishJpegFile") { (path: String, rotation: Int) throws in
      guard let server = self.server else {
        try? FileManager.default.removeItem(atPath: path)
        throw NSError(domain: "VigiaCameraServer", code: 1, userInfo: [
          NSLocalizedDescriptionKey: "El servidor MJPEG no está iniciado.",
        ])
      }
      defer { try? FileManager.default.removeItem(atPath: path) }
      guard [0, 90, 180, 270].contains(rotation) else {
        throw NSError(domain: "VigiaCameraServer", code: 2, userInfo: [
          NSLocalizedDescriptionKey: "La rotación debe ser 0, 90, 180 o 270 grados.",
        ])
      }
      let attributes = try FileManager.default.attributesOfItem(atPath: path)
      guard let size = attributes[.size] as? NSNumber, size.intValue <= 32 * 1024 * 1024,
            let image = UIImage(contentsOfFile: path), let cgImage = image.cgImage else {
        throw NSError(domain: "VigiaCameraServer", code: 3, userInfo: [
          NSLocalizedDescriptionKey: "No se encontró un JPEG válido de cámara de hasta 32 MiB.",
        ])
      }
      let scale = min(1.0, 960.0 / Double(max(cgImage.width, cgImage.height)))
      let sourceSize = CGSize(width: Double(cgImage.width) * scale, height: Double(cgImage.height) * scale)
      let targetSize = rotation == 90 || rotation == 270
        ? CGSize(width: sourceSize.height, height: sourceSize.width)
        : sourceSize
      let renderer = UIGraphicsImageRenderer(size: targetSize, format: UIGraphicsImageRendererFormat())
      let normalized = renderer.image { context in
        context.cgContext.translateBy(x: targetSize.width / 2, y: targetSize.height / 2)
        context.cgContext.rotate(by: CGFloat(rotation) * .pi / 180)
        image.draw(in: CGRect(
          x: -sourceSize.width / 2,
          y: -sourceSize.height / 2,
          width: sourceSize.width,
          height: sourceSize.height
        ))
      }
      guard let jpeg = normalized.jpegData(compressionQuality: 0.8) else {
        throw NSError(domain: "VigiaCameraServer", code: 4, userInfo: [
          NSLocalizedDescriptionKey: "No se pudo codificar el frame JPEG.",
        ])
      }
      server.publish(jpeg)
    }

    Function("getStatus") {
      self.server?.status() ?? [
        "running": false,
        "port": 0,
        "clients": 0,
        "frames": 0,
        "fps": 0.0,
      ]
    }

    Function("getLocalAddresses") {
      MjpegHttpServer.localAddresses()
    }

    AsyncFunction("stop") {
      self.server?.stop()
      self.server = nil
    }

    OnDestroy {
      self.server?.stop()
      self.server = nil
    }
  }
}
