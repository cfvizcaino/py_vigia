package expo.modules.vigiacameraserver

import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.Base64
import java.util.ArrayDeque
import java.util.Collections
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Local MJPEG server, the same contract as the Flutter app:
 * - `GET /video`    multipart MJPEG stream (at most [maxStreams] at once)
 * - `GET /shot.jpg` latest frame (503 until the first one)
 * - `GET /status`   JSON with fps, clients and frames
 *
 * Bound to loopback (USB mode, reached through `adb forward`) it needs no key.
 * On the local network every request carries the key, as `?key=` or as the
 * HTTP Basic password. Streams run on their own threads, so `/status` and
 * `/shot.jpg` keep answering while every stream slot is busy.
 */
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
  private var requests = createRequestWorkers()
  private var watchdog: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
  private var socket: ServerSocket? = null

  val address: String
    get() = host

  @Synchronized
  fun start(): String {
    if (running) return address
    if (requests.isShutdown) requests = createRequestWorkers()
    if (watchdog.isShutdown) watchdog = Executors.newSingleThreadScheduledExecutor()
    val server = ServerSocket()
    server.reuseAddress = true
    server.bind(InetSocketAddress(InetAddress.getByName(host), port), 16)
    socket = server
    running = true
    Thread({
      while (running) {
        try {
          val client = server.accept()
          client.tcpNoDelay = true
          client.soTimeout = 10_000
          clients.add(client)
          try {
            requests.execute { handle(client) }
          } catch (_: RuntimeException) {
            clients.remove(client)
            closeQuietly(client)
          }
        } catch (_: Exception) {
          if (running) stop()
        }
      }
    }, "vigia-mjpeg-accept").apply { isDaemon = true; start() }
    return address
  }

  @Synchronized
  fun stop() {
    if (!running && socket == null) return
    running = false
    synchronized(frameLock) { frameLock.notifyAll() }
    closeQuietly(socket)
    socket = null
    clients.toList().forEach(::closeQuietly)
    clients.clear()
    requests.shutdownNow()
    watchdog.shutdownNow()
    // Each stream decrements its own slot as it ends; resetting here would
    // drive the count negative once those threads finish.
    latestFrame = null
    synchronized(recentFrames) { recentFrames.clear() }
  }

  /** Publishes an encoded JPEG to every client. Called from the camera thread. */
  fun publish(frame: ByteArray) {
    if (!running) return
    latestFrame = frame
    framesPublished++
    synchronized(recentFrames) { recentFrames.addLast(System.currentTimeMillis()) }
    synchronized(frameLock) {
      generation++
      frameLock.notifyAll()
    }
  }

  fun status(): Map<String, Any> {
    val now = System.currentTimeMillis()
    synchronized(recentFrames) {
      while (recentFrames.isNotEmpty() && now - recentFrames.first() > 3_000) recentFrames.removeFirst()
      return mapOf(
        "running" to running,
        "port" to if (running) port else 0,
        "clients" to activeStreams.get().coerceAtLeast(0),
        "frames" to framesPublished,
        "fps" to (recentFrames.size / 3.0),
      )
    }
  }

  private fun handle(client: Socket) {
    var handedOff = false
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
      val uri = try {
        URI(request[1])
      } catch (_: Exception) {
        respond(client, 400, "Bad Request")
        return
      }
      if (!authorized(uri, headers["authorization"])) {
        respond(client, 401, "Unauthorized", mapOf("WWW-Authenticate" to "Basic realm=\"VIGIA camara\""))
        return
      }
      when (uri.path) {
        "/status" -> {
          val state = status()
          val body = """{"service":"vigia-camera","fps":${"%.1f".format(java.util.Locale.US, state["fps"])},"clients":${state["clients"]},"frames":${state["frames"]}}"""
          respond(client, 200, "OK", mapOf("Content-Type" to "application/json"), body.toByteArray())
        }
        "/shot.jpg" -> {
          val frame = latestFrame
          if (frame == null) respond(client, 503, "Service Unavailable")
          else respond(client, 200, "OK", mapOf("Content-Type" to "image/jpeg"), frame)
        }
        "/video" -> {
          if (activeStreams.incrementAndGet() > maxStreams) {
            activeStreams.decrementAndGet()
            respond(client, 503, "Too Many Clients")
            return
          }
          handedOff = true
          Thread({ stream(client, input) }, "vigia-mjpeg-stream").apply { isDaemon = true; start() }
        }
        else -> respond(client, 404, "Not Found")
      }
    } catch (_: Exception) {
      // Malformed or dropped request: the finally block closes it.
    } finally {
      if (!handedOff) {
        clients.remove(client)
        closeQuietly(client)
      }
    }
  }

  private fun stream(client: Socket, input: InputStream) {
    try {
      val output = client.getOutputStream()
      timedWrite(client) {
        output.write(
          "HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=frame\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
            .toByteArray(StandardCharsets.US_ASCII),
        )
        output.flush()
      }
      var lastGeneration = 0L
      while (running && !client.isClosed) {
        val frame: ByteArray?
        synchronized(frameLock) {
          if (generation == lastGeneration && running) frameLock.wait(1_000)
          frame = if (generation != lastGeneration) latestFrame else null
          if (frame != null) lastGeneration = generation
        }
        if (frame == null) {
          // No frame for a second: notice clients that already left, so they
          // do not keep a stream slot.
          if (peerClosed(client, input)) break
          continue
        }
        timedWrite(client) {
          output.write("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.size}\r\n\r\n".toByteArray(StandardCharsets.US_ASCII))
          output.write(frame)
          output.write(byteArrayOf(13, 10))
          output.flush()
        }
      }
    } catch (_: Exception) {
      // Disconnected or stalled reader; only this stream ends.
    } finally {
      activeStreams.decrementAndGet()
      clients.remove(client)
      closeQuietly(client)
    }
  }

  /** A reader that stops consuming would block the write forever: close it after [writeTimeoutMs]. */
  private inline fun timedWrite(client: Socket, block: () -> Unit) {
    val guard = watchdog.schedule({ closeQuietly(client) }, writeTimeoutMs, TimeUnit.MILLISECONDS)
    try {
      block()
    } finally {
      guard.cancel(false)
    }
  }

  private fun peerClosed(client: Socket, input: InputStream): Boolean {
    val previous = client.soTimeout
    return try {
      client.soTimeout = 1
      input.read() < 0
    } catch (_: SocketTimeoutException) {
      false
    } catch (_: Exception) {
      true
    } finally {
      try { client.soTimeout = previous } catch (_: Exception) {}
    }
  }

  internal fun publishFrame(frame: ByteArray) {
    check(running) { "El servidor MJPEG no está iniciado." }
    publish(frame)
  }

  private fun authorized(uri: URI, header: String?): Boolean {
    val expected = accessKey
    if (expected.isNullOrEmpty()) return true
    val queryKey = uri.rawQuery?.split('&')?.firstNotNullOfOrNull { item ->
      val separator = item.indexOf('=')
      if (separator < 0 || item.substring(0, separator) != "key") null
      else URLDecoder.decode(item.substring(separator + 1), StandardCharsets.UTF_8.name())
    }
    if (queryKey != null && constantTimeEquals(queryKey, expected)) return true
    if (header?.startsWith("Basic ", ignoreCase = true) != true) return false
    return try {
      val decoded = String(Base64.getDecoder().decode(header.substringAfter(' ')), StandardCharsets.UTF_8)
      ':' in decoded && constantTimeEquals(decoded.substringAfter(':'), expected)
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
    timedWrite(client) {
      output.write("HTTP/1.1 $code $reason\r\n$extra".toByteArray(StandardCharsets.US_ASCII))
      output.write("Content-Length: ${body.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n".toByteArray(StandardCharsets.US_ASCII))
      output.write(body)
      output.flush()
    }
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
    const val maxStreams = 4
    private const val writeTimeoutMs = 10_000L

    private fun createRequestWorkers() = ThreadPoolExecutor(
      2,
      2,
      0L,
      TimeUnit.MILLISECONDS,
      ArrayBlockingQueue(16),
      ThreadPoolExecutor.AbortPolicy(),
    )

    private fun closeQuietly(closeable: java.io.Closeable?) {
      try { closeable?.close() } catch (_: Exception) {}
    }

    private fun constantTimeEquals(actual: String, expected: String): Boolean =
      MessageDigest.isEqual(actual.toByteArray(StandardCharsets.UTF_8), expected.toByteArray(StandardCharsets.UTF_8))

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
