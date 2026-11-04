import Foundation
import Network
import Darwin

final class MjpegHttpServer {
  private final class Client {
    let connection: NWConnection
    var request = Data()
    var streaming = false
    var sending = false
    var lastGeneration: UInt64 = 0

    init(_ connection: NWConnection) {
      self.connection = connection
    }
  }

  private let host: String
  private let port: Int
  private let accessKey: String?
  private let queue = DispatchQueue(label: "co.vigia.mjpeg")
  private let lock = NSLock()
  private var listener: NWListener?
  private var clients: [ObjectIdentifier: Client] = [:]
  private var running = false
  private var latestFrame: Data?
  private var generation: UInt64 = 0
  private var framesPublished: UInt64 = 0
  private var recentFrames: [Date] = []

  init(host: String, port: Int, accessKey: String?) {
    self.host = host
    self.port = port
    self.accessKey = accessKey
  }

  var isRunning: Bool {
    lock.lock()
    defer { lock.unlock() }
    return running
  }

  func start() throws {
    guard let nwPort = NWEndpoint.Port(rawValue: UInt16(port)) else {
      throw serverError("El puerto del servidor MJPEG no es válido.")
    }
    let parameters = NWParameters.tcp
    parameters.requiredLocalEndpoint = .hostPort(host: NWEndpoint.Host(host), port: nwPort)
    let next = try NWListener(using: parameters)
    let ready = DispatchSemaphore(value: 0)
    var startupError: Error?
    next.stateUpdateHandler = { state in
      switch state {
      case .ready:
        ready.signal()
      case .failed(let error):
        startupError = error
        ready.signal()
      default:
        break
      }
    }
    next.newConnectionHandler = { [weak self] connection in
      self?.accept(connection)
    }
    next.start(queue: queue)
    guard ready.wait(timeout: .now() + 5) == .success else {
      next.cancel()
      throw serverError("Se agotó el tiempo al iniciar el servidor MJPEG.")
    }
    if let startupError {
      next.cancel()
      throw startupError
    }
    lock.lock()
    listener = next
    running = true
    lock.unlock()
  }

  func stop() {
    lock.lock()
    running = false
    let active = Array(clients.values)
    clients.removeAll()
    listener?.cancel()
    listener = nil
    latestFrame = nil
    recentFrames.removeAll()
    lock.unlock()
    active.forEach { $0.connection.cancel() }
  }

  func publish(_ frame: Data) {
    lock.lock()
    latestFrame = frame
    generation += 1
    framesPublished += 1
    recentFrames.append(Date())
    recentFrames.removeAll { Date().timeIntervalSince($0) > 3 }
    let active = Array(clients.values.filter(\.streaming))
    lock.unlock()
    active.forEach(pump)
  }

  func status() -> [String: Any] {
    lock.lock()
    defer { lock.unlock() }
    recentFrames.removeAll { Date().timeIntervalSince($0) > 3 }
    return [
      "running": running,
      "port": running ? port : 0,
      "clients": clients.values.filter(\.streaming).count,
      "frames": framesPublished,
      "fps": Double(recentFrames.count) / 3.0,
    ]
  }

  private func accept(_ connection: NWConnection) {
    let client = Client(connection)
    let identifier = ObjectIdentifier(connection)
    lock.lock()
    clients[identifier] = client
    lock.unlock()
    connection.stateUpdateHandler = { [weak self, weak client] state in
      if case .failed = state { self?.remove(client) }
      if case .cancelled = state { self?.remove(client) }
    }
    connection.start(queue: queue)
    receive(client)
  }

  private func receive(_ client: Client) {
    client.connection.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { [weak self, weak client] data, _, complete, error in
      guard let self, let client else { return }
      if let data { client.request.append(data) }
      if client.request.count > 16_384 || error != nil || complete {
        self.respond(client, status: 400, reason: "Bad Request")
        return
      }
      guard let separator = client.request.range(of: Data([13, 10, 13, 10])) else {
        self.receive(client)
        return
      }
      let requestData = client.request[..<separator.lowerBound]
      guard let request = String(data: requestData, encoding: .isoLatin1) else {
        self.respond(client, status: 400, reason: "Bad Request")
        return
      }
      self.route(client, request: request)
    }
  }

  private func route(_ client: Client, request: String) {
    let lines = request.components(separatedBy: "\r\n")
    let parts = lines.first?.split(separator: " ", omittingEmptySubsequences: true) ?? []
    guard parts.count >= 2 else {
      respond(client, status: 400, reason: "Bad Request")
      return
    }
    guard parts[0] == "GET" else {
      respond(client, status: 405, reason: "Method Not Allowed")
      return
    }
    var headers: [String: String] = [:]
    for line in lines.dropFirst() {
      guard let separator = line.firstIndex(of: ":") else { continue }
      headers[String(line[..<separator]).lowercased()] = String(line[line.index(after: separator)...]).trimmingCharacters(in: .whitespaces)
    }
    let target = String(parts[1])
    guard authorized(target: target, authorization: headers["authorization"]) else {
      respond(client, status: 401, reason: "Unauthorized", headers: ["WWW-Authenticate": "Basic realm=\"VIGIA camera\""])
      return
    }
    guard let url = URLComponents(string: "http://localhost\(target)") else {
      respond(client, status: 400, reason: "Bad Request")
      return
    }
    switch url.path {
    case "/status":
      let current = status()
      let body = (try? JSONSerialization.data(withJSONObject: [
        "service": "vigia-camera",
        "fps": current["fps"] ?? 0,
        "clients": current["clients"] ?? 0,
        "frames": current["frames"] ?? 0,
      ])) ?? Data()
      respond(client, status: 200, reason: "OK", headers: ["Content-Type": "application/json"], body: body)
    case "/shot.jpg":
      lock.lock()
      let frame = latestFrame
      lock.unlock()
      guard let frame else {
        respond(client, status: 503, reason: "Service Unavailable")
        return
      }
      respond(client, status: 200, reason: "OK", headers: ["Content-Type": "image/jpeg"], body: frame)
    case "/video":
      lock.lock()
      let count = clients.values.filter(\.streaming).count
      if count < 4 { client.streaming = true }
      lock.unlock()
      guard count < 4 else {
        respond(client, status: 503, reason: "Too Many Clients")
        return
      }
      client.connection.send(content: Data("HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=frame\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n".utf8), completion: .contentProcessed { [weak self, weak client] error in
        guard let self, let client else { return }
        if error != nil { self.remove(client) } else { self.pump(client) }
      })
    default:
      respond(client, status: 404, reason: "Not Found")
    }
  }

  private func authorized(target: String, authorization: String?) -> Bool {
    guard let accessKey, !accessKey.isEmpty else { return true }
    if URLComponents(string: "http://localhost\(target)")?.queryItems?.contains(where: { $0.name == "key" && $0.value == accessKey }) == true {
      return true
    }
    guard let authorization, authorization.lowercased().hasPrefix("basic "),
          let data = Data(base64Encoded: String(authorization.dropFirst(6)), options: .ignoreUnknownCharacters),
          let decoded = String(data: data, encoding: .utf8),
          let separator = decoded.firstIndex(of: ":") else { return false }
    return decoded[decoded.index(after: separator)...] == accessKey
  }

  private func pump(_ client: Client) {
    lock.lock()
    guard client.streaming, !client.sending, generation > client.lastGeneration,
          let frame = latestFrame else {
      lock.unlock()
      return
    }
    client.sending = true
    let sentGeneration = generation
    lock.unlock()
    var packet = Data("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: \(frame.count)\r\n\r\n".utf8)
    packet.append(frame)
    packet.append(Data([13, 10]))
    client.connection.send(content: packet, completion: .contentProcessed { [weak self, weak client] error in
      guard let self, let client else { return }
      self.lock.lock()
      client.sending = false
      if error == nil { client.lastGeneration = sentGeneration }
      self.lock.unlock()
      if error == nil { self.pump(client) } else { self.remove(client) }
    })
  }

  private func respond(_ client: Client, status: Int, reason: String, headers: [String: String] = [:], body: Data = Data()) {
    let customHeaders = headers.map { "\($0.key): \($0.value)\r\n" }.joined()
    var response = Data("HTTP/1.1 \(status) \(reason)\r\n\(customHeaders)Content-Length: \(body.count)\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n".utf8)
    response.append(body)
    client.connection.send(content: response, completion: .contentProcessed { [weak self, weak client] _ in
      guard let self, let client else { return }
      self.remove(client)
    })
  }

  private func remove(_ client: Client?) {
    guard let client else { return }
    lock.lock()
    clients.removeValue(forKey: ObjectIdentifier(client.connection))
    lock.unlock()
    client.connection.cancel()
  }

  private func serverError(_ message: String) -> NSError {
    NSError(domain: "VigiaCameraServer", code: 5, userInfo: [NSLocalizedDescriptionKey: message])
  }

  static func localAddresses() -> [String] {
    var addresses: [String] = []
    var interfaces: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&interfaces) == 0, let first = interfaces else { return addresses }
    defer { freeifaddrs(interfaces) }
    for interface in sequence(first: first, next: { $0.pointee.ifa_next }) {
      guard let address = interface.pointee.ifa_addr, address.pointee.sa_family == UInt8(AF_INET),
            Int32(interface.pointee.ifa_flags & UInt32(IFF_LOOPBACK)) == 0 else { continue }
      var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
      let socketAddress = UnsafeRawPointer(address).assumingMemoryBound(to: sockaddr_in.self)
      if inet_ntop(AF_INET, &socketAddress.pointee.sin_addr, &buffer, socklen_t(INET_ADDRSTRLEN)) != nil {
        addresses.append(String(cString: buffer))
      }
    }
    return Array(Set(addresses)).sorted()
  }
}
