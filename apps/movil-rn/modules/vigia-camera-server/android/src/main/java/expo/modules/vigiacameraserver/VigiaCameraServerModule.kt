package expo.modules.vigiacameraserver

import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.typedarray.Uint8Array

class VigiaCameraServerModule : Module() {
  private var server: MjpegHttpServer?
    get() = CameraServerHolder.server
    set(value) { CameraServerHolder.server = value }

  override fun definition() = ModuleDefinition {
    Name("VigiaCameraServer")

    AsyncFunction("start") { host: String, port: Int, accessKey: String? ->
      // Restart rather than reuse: the link (USB/LAN) or the key may have changed.
      server?.stop()
      val next = MjpegHttpServer(host, port, accessKey)
      next.start()
      server = next
      next.address
    }

    // Recorte of a vehicle for an admin to confirm by eye: RGB pixels from the
    // frame processor, encoded here because JPEG in JavaScript is too slow.
    AsyncFunction("encodeRgbJpeg") { pixels: Uint8Array, width: Int, height: Int, quality: Int ->
      require(width in 1..4096 && height in 1..4096) { "Tamaño de recorte inválido." }
      require(pixels.byteLength == width * height * 3) { "El recorte no tiene width × height × 3 bytes." }
      val rgb = ByteArray(pixels.byteLength)
      pixels.read(rgb, 0, rgb.size)
      val colors = IntArray(width * height) { index ->
        val offset = index * 3
        (0xFF shl 24) or
          ((rgb[offset].toInt() and 0xFF) shl 16) or
          ((rgb[offset + 1].toInt() and 0xFF) shl 8) or
          (rgb[offset + 2].toInt() and 0xFF)
      }
      val bitmap = Bitmap.createBitmap(colors, width, height, Bitmap.Config.ARGB_8888)
      try {
        ByteArrayOutputStream().use { output ->
          check(bitmap.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(1, 100), output)) {
            "No se pudo codificar el recorte JPEG."
          }
          android.util.Base64.encodeToString(output.toByteArray(), android.util.Base64.NO_WRAP)
        }
      } finally {
        bitmap.recycle()
      }
    }

    AsyncFunction("readFlutterData") {
      val context = appContext.reactContext ?: return@AsyncFunction emptyMap<String, String>()
      FlutterDataMigration.read(context)
    }

    AsyncFunction("clearFlutterData") {
      appContext.reactContext?.let(FlutterDataMigration::clear)
    }

    View(CameraStreamView::class) {
      Events("onCameraStarted", "onCameraError")
      Prop("active") { view: CameraStreamView, active: Boolean ->
        view.active = active
      }
      Prop("fps") { view: CameraStreamView, fps: Int ->
        view.fps = fps
      }
      Prop("extraRotation") { view: CameraStreamView, rotation: Int ->
        view.extraRotation = rotation
      }
      OnViewDidUpdateProps { view: CameraStreamView ->
        view.refresh()
      }
      OnViewDestroys { view: CameraStreamView ->
        view.destroy()
      }
    }

    AsyncFunction("openApkInstaller") { fileUri: String, expectedSha256: String ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("No está disponible el contexto Android para abrir el instalador.")
      require(expectedSha256.matches(Regex("^[0-9a-fA-F]{64}$"))) { "La huella SHA-256 no es válida." }
      val sourceUri = Uri.parse(fileUri)
      require(sourceUri.scheme == "file") { "El APK debe estar en un archivo local verificado." }
      val updateDirectory = File(context.cacheDir, "updates").canonicalFile
      val apk = File(sourceUri.path ?: "").canonicalFile
      require(apk.parentFile == updateDirectory && apk.name == "vigia-update.apk" && apk.isFile) {
        "El archivo no es el APK de actualización verificado de VIGÍA."
      }
      val digest = MessageDigest.getInstance("SHA-256")
      FileInputStream(apk).use { input ->
        val buffer = ByteArray(64 * 1024)
        while (true) {
          val count = input.read(buffer)
          if (count < 0) break
          digest.update(buffer, 0, count)
        }
      }
      val actualSha256 = digest.digest().joinToString("") { "%02x".format(it) }
      require(actualSha256.equals(expectedSha256, ignoreCase = true)) {
        "El APK no coincide con SHA-256. No se abrió el instalador."
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
        context.startActivity(
          Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${context.packageName}"),
          ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        mapOf("permissionRequired" to true)
      } else {
        val contentUri = FileProvider.getUriForFile(
          context,
          "${context.packageName}.fileprovider",
          apk,
        )
        val intent = Intent(Intent.ACTION_VIEW)
          .setDataAndType(contentUri, "application/vnd.android.package-archive")
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        mapOf("permissionRequired" to false)
      }
    }

    Function("getStatus") {
      server?.status() ?: mapOf(
        "running" to false,
        "port" to 0,
        "clients" to 0,
        "frames" to 0,
        "fps" to 0.0,
      )
    }

    Function("getLocalAddresses") {
      MjpegHttpServer.localAddresses()
    }

    AsyncFunction("stop") {
      val current = server
      server = null
      current?.stop()
    }

    OnDestroy {
      server?.stop()
      server = null
    }
  }
}
