import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:http/http.dart' as http;

/// The central answered and will never accept this exact event: set it aside so
/// it does not block every later event (same rule as the PC node's publisher).
const eventRejectedCodes = {400, 409, 413, 422};
const maxBackoff = Duration(seconds: 30);

class OutboxStatus {
  const OutboxStatus({
    required this.pending,
    required this.rejected,
    required this.delivered,
    required this.retries,
    this.lastError,
    this.lastDeliveredAt,
  });

  final int pending;
  final int rejected;
  final int delivered;
  final int retries;
  final String? lastError;
  final DateTime? lastDeliveredAt;
}

/// Disk-first queue: an event is written before sending and deleted only after a
/// 2xx from the central, so a dead network, a killed app or a reboot loses nothing.
class Outbox {
  Outbox({
    required this.directory,
    required this.serverUrl,
    required this.token,
    http.Client? client,
    this.timeout = const Duration(seconds: 10),
    this.initialBackoff = const Duration(seconds: 1),
    this.maxQueue = 10000,
    Random? random,
  }) : _client = client ?? http.Client(),
       _random = random ?? Random();

  final Directory directory;
  final String serverUrl;
  final String token;
  final Duration timeout;
  final Duration initialBackoff;
  final int maxQueue;
  final http.Client _client;
  final Random _random;

  bool _running = false;
  Completer<void>? _wake;
  int _delivered = 0;
  int _retries = 0;
  String? _lastError;
  DateTime? _lastDeliveredAt;

  Directory get rejectedDirectory => Directory('${directory.path}/rejected');

  List<File> _pendingFiles() {
    if (!directory.existsSync()) return const [];
    final files =
        directory
            .listSync()
            .whereType<File>()
            .where((file) => file.path.endsWith('.json'))
            .toList()
          ..sort((a, b) => a.path.compareTo(b.path));
    return files;
  }

  OutboxStatus get status => OutboxStatus(
    pending: _pendingFiles().length,
    rejected: rejectedDirectory.existsSync()
        ? rejectedDirectory.listSync().whereType<File>().length
        : 0,
    delivered: _delivered,
    retries: _retries,
    lastError: _lastError,
    lastDeliveredAt: _lastDeliveredAt,
  );

  /// Persists an envelope; returns false when the queue is full.
  Future<bool> enqueue(Map<String, dynamic> envelope) async {
    await directory.create(recursive: true);
    if (_pendingFiles().length >= maxQueue) {
      _lastError = 'OUTBOX_FULL';
      return false;
    }
    final sequence = (envelope['sequenceNumber'] as int).toString().padLeft(
      20,
      '0',
    );
    final session = (envelope['sessionId'] as String).substring(0, 8);
    final name = '$session-$sequence-${envelope['eventId']}.json';
    final temporary = File('${directory.path}/.$name.tmp');
    await temporary.writeAsString(jsonEncode(envelope), flush: true);
    await temporary.rename(
      '${directory.path}/$name',
    ); // Atomic: never a half-written event.
    _wake?.complete();
    _wake = null;
    return true;
  }

  void start() {
    if (_running) return;
    _running = true;
    unawaited(_loop());
  }

  void stop() {
    _running = false;
    _wake?.complete();
    _wake = null;
  }

  Future<void> _loop() async {
    var backoff = initialBackoff;
    while (_running) {
      final files = _pendingFiles();
      if (files.isEmpty) {
        _wake = Completer<void>();
        await _wake!.future.timeout(
          const Duration(seconds: 5),
          onTimeout: () {},
        );
        continue;
      }
      final file = files.first;
      String body;
      try {
        body = await file.readAsString();
        jsonDecode(body);
      } on FormatException {
        await _reject(file, 'INVALID_JSON');
        continue;
      } on FileSystemException {
        continue; // Raced with a rename; look again.
      }
      try {
        final response = await _client
            .post(
              Uri.parse(
                '${serverUrl.replaceAll(RegExp(r'/+$'), '')}/api/v1/ingest/detections',
              ),
              headers: {
                'Content-Type': 'application/json',
                'X-Vigia-Device-Token': token,
                'User-Agent': 'vigia-edge-movil/1.1',
              },
              body: body,
            )
            .timeout(timeout);
        if (response.statusCode >= 200 && response.statusCode < 300) {
          await file.delete();
          _delivered++;
          _lastDeliveredAt = DateTime.now();
          _lastError = null;
          backoff = initialBackoff;
          continue;
        }
        if (eventRejectedCodes.contains(response.statusCode)) {
          await _reject(file, '${response.statusCode}');
          continue;
        }
        // 401/403/404 are node-level (token, camera registration): retry, never drop.
        _lastError = 'HTTP_${response.statusCode}';
      } on TimeoutException {
        _lastError = 'TIMEOUT';
      } on http.ClientException {
        _lastError = 'NETWORK';
      } on SocketException {
        _lastError = 'NETWORK';
      }
      _retries++;
      // Jitter keeps many edges from retrying in lockstep when the central returns.
      final factor = 0.8 + _random.nextDouble() * 0.4;
      await Future<void>.delayed(backoff * factor);
      backoff = backoff * 2 > maxBackoff ? maxBackoff : backoff * 2;
    }
  }

  Future<void> _reject(File file, String reason) async {
    await rejectedDirectory.create(recursive: true);
    final name = file.uri.pathSegments.last.replaceAll(
      '.json',
      '.$reason.json',
    );
    await file.rename('${rejectedDirectory.path}/$name');
    _lastError = 'REJECTED_$reason';
  }
}
