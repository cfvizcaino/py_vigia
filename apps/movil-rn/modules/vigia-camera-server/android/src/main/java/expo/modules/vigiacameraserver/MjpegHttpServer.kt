package expo.modules.vigiacameraserver

import android.graphics.BitmapFactory
import android.graphics.Bitmap
import android.graphics.Matrix
import android.net.Uri
import android.util.Base64
import androidx.exifinterface.media.ExifInterface
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.util.ArrayDeque
import java.util.Collections
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.max

internal class MjpegHttpServer(
  private val host: String,
  private val port: Int,
  private val accessKey: String?,
) {
  @Volatile private var running = false
  val isRunning: Boolean
    get() = running
  @Volatile private var latestFrame: ByteArray? = null
  @Volatile private var generation = 0L
  @Volatile private var framesPublished = 0L
  private val frameLock = Object()
  private val recentFrames = ArrayDeque<Long>()
  private val clients = ConcurrentHashMap.newKeySet<Socket>()
  private val activeStreams = AtomicInteger()
  @Volatile private var workers = createWorkers()
  private var socket: ServerSocket? = null
  private var acceptThread: Thread? = null

  val address: String
    get() = host

  fun start(): String {
    if (running) return address
    if (workers.isShutdown) workers = createWorkers()
    val server = ServerSocket()
    server.reuseAddress = true
    server.bind(InetSocketAddress(InetAddress.getByName(host), port), 16)
    socket = server
    running = true
    acceptThread = Thread({
      while (running) {
        try {
          val client = server.accept()
          client.tcpNoDelay = true
          client.soTimeout = 10_000
          clients.add(client)
          try {
            workers.execute { handle(client) }
          } catch (_: RuntimeException) {
            clients.remove(client)
            client.close()
          }
        } catch (_: Exception) {
          if (running) stop()
        }
      }
    }, "vigia-mjpeg-accept").apply { isDaemon = true; start() }
    return address
  }

  fun stop() {
    if (!running && socket == null) return
    running = false
    synchronized(frameLock) { frameLock.notifyAll() }
    try { socket?.close() } catch (_: Exception) {}
    socket = null
    clients.toList().forEach { try { it.close() } catch (_: Exception) {} }
    clients.clear()
    workers.shutdownNow()
    activeStreams.set(0)
    latestFrame = null
    synchronized(recentFrames) { recentFrames.clear() }
  }

  fun publishJpegFile(path: String, rotation: Int) {
    require(rotation in setOf(0, 90, 180, 270)) { "La rotación debe ser 0, 90, 180 o 270 grados." }
    val file = File(path)
    try {
      check(running) { "El servidor MJPEG no está iniciado." }
      require(file.isFile) { "No se encontró el JPEG temporal de cámara." }
      require(file.length() <= 32L * 1024 * 1024) { "El JPEG temporal supera el máximo de 32 MiB." }
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(file.absolutePath, bounds)
      require(bounds.outWidth > 0 && bounds.outHeight > 0) { "El archivo de cámara no es un JPEG válido." }
      var sample = 1
      while (max(bounds.outWidth, bounds.outHeight) / sample > 960) sample *= 2
      val bitmap = BitmapFactory.decodeFile(
        file.absolutePath,
        BitmapFactory.Options().apply { inSampleSize = sample },
      ) ?: throw IllegalArgumentException("No se pudo decodificar el JPEG de cámara.")
      val exifRotation = when (ExifInterface(file.absolutePath).getAttributeInt(
        ExifInterface.TAG_ORIENTATION,
        ExifInterface.ORIENTATION_NORMAL,
      )) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90
        ExifInterface.ORIENTATION_ROTATE_180 -> 180
        ExifInterface.ORIENTATION_ROTATE_270 -> 270
        else -> 0
      }
      val totalRotation = (rotation + exifRotation) % 360
      val oriented = if (totalRotation == 0) bitmap else {
        val matrix = Matrix().apply { postRotate(totalRotation.toFloat()) }
        Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true).also {
          if (it !== bitmap) bitmap.recycle()
        }
      }
      val bytes = ByteArrayOutputStream().use { output ->
        check(oriented.compress(Bitmap.CompressFormat.JPEG, 80, output)) { "No se pudo codificar el frame JPEG." }
        output.toByteArray()
      }
      oriented.recycle()
      publish(bytes)
    } finally {
      file.delete()
    }
  }

  fun status(): Map<String, Any> {
    val now = System.currentTimeMillis()
    synchronized(recentFrames) {
      while (recentFrames.isNotEmpty() && now - recentFrames.first() > 3_000) recentFrames.removeFirst()
      return mapOf(
        "running" to running,
        "port" to if (running) port else 0,
        "clients" to activeStreams.get(),
        "frames" to framesPublished,
        "fps" to (recentFrames.size / 3.0),
      )
    }
  }

  private fun publish(frame: ByteArray) {
    latestFrame = frame
    framesPublished++
    synchronized(recentFrames) { recentFrames.addLast(System.currentTimeMillis()) }
    synchronized(frameLock) {
      generation++
      frameLock.notifyAll()
    }
  }

  private fun handle(client: Socket) {
    try {
      val input = BufferedInputStream(client.getInputStream())
      val request = readLine(input, 4096)?.split(' ', limit = 3) ?: return
      if (request.size < 2) {
        respond(client, 400, "Bad Request")
        return
      }
      val headers = mutableMapOf<String, String>()
      var headerBytes = 0
      while (true) {
        val line = readLine(input, 8192) ?: return
        headerBytes += line.length
        if (headerBytes > 16_384) {
          respond(client, 431, "Request Header Fields Too Large")
          return
        }
        if (line.isEmpty()) break
        val separator = line.indexOf(':')
        if (separator > 0) headers[line.substring(0, separator).trim().lowercase()] =
          line.substring(separator + 1).trim()
      }
      if (request[0] != "GET") {
        respond(client, 405, "Method Not Allowed")
        return
      }
      val uri = Uri.parse(request[1])
      if (!authorized(uri, headers["authorization"])) {
        respond(client, 401, "Unauthorized", mapOf("WWW-Authenticate" to "Basic realm=\"VIGIA camera\""))
        return
      }
      when (uri.path) {
        "/status" -> {
          val state = status()
          val body = """{"service":"vigia-camera","fps":${"%.1f".format(java.util.Locale.US, state["fps"])}, "clients":${state["clients"]},"frames":${state["frames"]}}"""
          respond(client, 200, "OK", mapOf("Content-Type" to "application/json"), body.toByteArray())
        }
        "/shot.jpg" -> {
          val frame = latestFrame
          if (frame == null) respond(client, 503, "Service Unavailable")
          else respond(client, 200, "OK", mapOf("Content-Type" to "image/jpeg"), frame)
        }
        "/video" -> stream(client)
        else -> respond(client, 404, "Not Found")
      }
    } catch (_: Exception) {
      try { client.close() } catch (_: Exception) {}
    } finally {
      clients.remove(client)
    }
  }

  private fun stream(client: Socket) {
    if (activeStreams.incrementAndGet() > 4) {
      activeStreams.decrementAndGet()
      respond(client, 503, "Too Many Clients")
      return
    }
    try {
      val output = client.getOutputStream()
      output.write(
        "HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=frame\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
          .toByteArray(StandardCharsets.US_ASCII),
      )
      output.flush()
      var lastGeneration = 0L
      while (running && !client.isClosed) {
        val frame: ByteArray?
        synchronized(frameLock) {
          if (generation == lastGeneration && running) frameLock.wait(1_000)
          frame = if (generation != lastGeneration) latestFrame else null
          if (frame != null) lastGeneration = generation
        }
        if (frame == null) continue
        output.write("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.size}\r\n\r\n".toByteArray(StandardCharsets.US_ASCII))
        output.write(frame)
        output.write(byteArrayOf(13, 10))
        output.flush()
      }
    } catch (_: Exception) {
      // Disconnected and slow readers are isolated to this bounded worker.
    } finally {
      activeStreams.decrementAndGet()
      try { client.close() } catch (_: Exception) {}
    }
  }

  private fun authorized(uri: Uri, header: String?): Boolean {
    val expected = accessKey
    if (expected.isNullOrEmpty()) return true
    if (uri.getQueryParameter("key") == expected) return true
    if (header?.startsWith("Basic ", ignoreCase = true) != true) return false
    return try {
      val decoded = String(Base64.decode(header.substringAfter(' '), Base64.DEFAULT), StandardCharsets.UTF_8)
      decoded.substringAfter(':', "") == expected && ':' in decoded
    } catch (_: Exception) {
      false
    }
  }

  private fun respond(
    client: Socket,
    code: Int,
    reason: String,
    headers: Map<String, String> = emptyMap(),
    body: ByteArray = ByteArray(0),
  ) {
    val output = client.getOutputStream()
    val extra = headers.entries.joinToString("") { "${it.key}: ${it.value}\r\n" }
    output.write("HTTP/1.1 $code $reason\r\n$extra".toByteArray(StandardCharsets.US_ASCII))
    output.write("Content-Length: ${body.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n".toByteArray(StandardCharsets.US_ASCII))
    output.write(body)
    output.flush()
  }

  private fun readLine(input: InputStream, limit: Int): String? {
    val bytes = ByteArrayOutputStream()
    while (bytes.size() <= limit) {
      val next = input.read()
      if (next < 0) return if (bytes.size() == 0) null else bytes.toString("ISO-8859-1").trimEnd('\r')
      if (next == '\n'.code) return bytes.toString("ISO-8859-1").trimEnd('\r')
      bytes.write(next)
    }
    throw IllegalArgumentException("La línea HTTP supera el tamaño permitido.")
  }

  companion object {
    private fun createWorkers() = ThreadPoolExecutor(
      4,
      4,
      0L,
      TimeUnit.MILLISECONDS,
      ArrayBlockingQueue(16),
      ThreadPoolExecutor.AbortPolicy(),
    )

    fun localAddresses(): List<String> {
      val addresses = mutableListOf<String>()
      val interfaces = NetworkInterface.getNetworkInterfaces() ?: return addresses
      for (network in Collections.list(interfaces)) {
        for (address in Collections.list(network.inetAddresses)) {
          if (!address.isLoopbackAddress && address.hostAddress?.contains(':') == false) {
            address.hostAddress?.let(addresses::add)
          }
        }
      }
      return addresses.distinct().sorted()
    }
  }
}
