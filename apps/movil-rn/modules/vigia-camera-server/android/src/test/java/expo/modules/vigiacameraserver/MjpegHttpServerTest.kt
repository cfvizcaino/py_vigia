package expo.modules.vigiacameraserver

import java.net.ServerSocket
import java.net.Socket
import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets
import java.util.Base64
import org.junit.Assert.assertTrue
import org.junit.Test

class MjpegHttpServerTest {
  @Test
  fun servesStatusShotAndVideoAndReturnsNotFoundAndMethodErrors() {
    withServer { server, port ->
      assertTrue(request(port, "GET", "/shot.jpg").startsWith("HTTP/1.1 503"))
      assertTrue(request(port, "GET", "/status").contains("HTTP/1.1 200"))
      assertTrue(request(port, "GET", "/status").contains("\"service\":\"vigia-camera\""))
      assertTrue(request(port, "GET", "/missing").startsWith("HTTP/1.1 404"))
      assertTrue(request(port, "POST", "/status").startsWith("HTTP/1.1 405"))

      server.publishFrame(byteArrayOf(1, 2, 3))
      assertTrue(request(port, "GET", "/shot.jpg").startsWith("HTTP/1.1 200"))
      assertTrue(request(port, "GET", "/video").contains("multipart/x-mixed-replace; boundary=frame"))
    }
  }

  @Test
  fun acceptsQueryAndBasicAuthenticationAndRejectsMissingKey() {
    withServer("safe-key-123") { _, port ->
      assertTrue(request(port, "GET", "/status").startsWith("HTTP/1.1 401"))
      assertTrue(request(port, "GET", "/status?key=safe-key-123").startsWith("HTTP/1.1 200"))
      val basic = Base64.getEncoder().encodeToString("edge:safe-key-123".toByteArray(StandardCharsets.UTF_8))
      assertTrue(request(port, "GET", "/status", "Authorization: Basic $basic").startsWith("HTTP/1.1 200"))
    }
  }

  @Test
  fun aSlowVideoClientDoesNotBlockOtherRequestsOrFramePublication() {
    withServer { server, port ->
      val slow = Socket("127.0.0.1", port)
      slow.soTimeout = 2_000
      slow.getOutputStream().write("GET /video HTTP/1.1\r\nHost: localhost\r\n\r\n".toByteArray(StandardCharsets.US_ASCII))
      slow.getOutputStream().flush()
      val largeFrame = ByteArray(2 * 1024 * 1024) { 0x5a }
      repeat(4) { server.publishFrame(largeFrame) }

      val status = request(port, "GET", "/status")
      assertTrue(status.startsWith("HTTP/1.1 200"))
      assertTrue(status.contains("\"frames\":4"))
      slow.close()
    }
  }

  private fun withServer(accessKey: String? = null, block: (MjpegHttpServer, Int) -> Unit) {
    val port = ServerSocket(0).use { it.localPort }
    val server = MjpegHttpServer("127.0.0.1", port, accessKey)
    server.start()
    try {
      block(server, port)
    } finally {
      server.stop()
    }
  }

  private fun request(port: Int, method: String, path: String, header: String? = null): String {
    return Socket("127.0.0.1", port).use { socket ->
      socket.soTimeout = 2_000
      val authorization = if (header == null) "" else "$header\r\n"
      socket.getOutputStream().write(
        "$method $path HTTP/1.1\r\nHost: localhost\r\n$authorization\r\n".toByteArray(StandardCharsets.US_ASCII),
      )
      socket.getOutputStream().flush()
      val input = socket.getInputStream()
      val response = ByteArrayOutputStream()
      var previous = 0
      var current: Int
      while (true) {
        current = input.read()
        if (current < 0) break
        response.write(current)
        if (previous == '\r'.code && current == '\n'.code) {
          val bytes = response.toByteArray()
          val size = bytes.size
          if (size >= 4 &&
            bytes[size - 4] == '\r'.code.toByte() &&
            bytes[size - 3] == '\n'.code.toByte() &&
            bytes[size - 2] == '\r'.code.toByte() &&
            bytes[size - 1] == '\n'.code.toByte()
          ) break
        }
        previous = current
      }
      val headers = response.toString(StandardCharsets.ISO_8859_1.name())
      val contentLength = Regex("(?im)^Content-Length: (\\d+)$")
        .find(headers)
        ?.groupValues
        ?.get(1)
        ?.toIntOrNull() ?: 0
      repeat(contentLength) {
        val byte = input.read()
        if (byte >= 0) response.write(byte)
      }
      String(response.toByteArray(), StandardCharsets.ISO_8859_1)
    }
  }
}
