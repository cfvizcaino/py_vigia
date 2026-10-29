package expo.modules.vigiacameraserver

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class VigiaCameraServerModule : Module() {
  @Volatile private var server: MjpegHttpServer? = null

  override fun definition() = ModuleDefinition {
    Name("VigiaCameraServer")

    AsyncFunction("start") { host: String, port: Int, accessKey: String? ->
      val current = server
      if (current?.isRunning == true) {
        current.address
      } else {
        val next = MjpegHttpServer(host, port, accessKey)
        next.start()
        server = next
        next.address
      }
    }

    AsyncFunction("publishJpegFile") { path: String, rotation: Int ->
      val current = server
      if (current == null) {
        File(path).delete()
        throw IllegalStateException("El servidor MJPEG no está iniciado.")
      }
      current.publishJpegFile(path, rotation)
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
