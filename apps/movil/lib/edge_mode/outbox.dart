import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

/// The central answered and will never accept this exact event: set it aside so
/// it does not block every later event (same rule as the PC node's publisher).
const eventRejectedCodes = {400, 409, 413, 422};
const maxBackoff = Duration(seconds: 30);

/// A recorte the central will never take (unknown track, too big, not a JPEG):
/// drop it. It is only for manual confirmation, so it is not kept aside.
const thumbnailDroppedCodes = {400, 404, 409, 413, 415, 422};

/// The central keeps no recortes (no storage configured): stop sending them.
const thumbnailsDisabledCode = 501;

class OutboxStatus {
  const OutboxStatus({
    required this.pending,
    required this.rejected,
    required this.delivered,
    required this.retries,
    this.lastError,
    this.lastDeliveredAt,
    this.thumbnails = 0,
    this.thumbnailsDropped = 0,
    this.thumbnailsAccepted = true,
  });

  final int pending;
  final int rejected;
  final int delivered;
  final int retries;
  final String? lastError;
  final DateTime? lastDeliveredAt;

  /// Recortes delivered, and dropped because the central refused them.
  final int thumbnails;
  final int thumbnailsDropped;
  final bool thumbnailsAccepted;
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
    this.maxThumbnailBacklog = 500,
    Random? random,
  }) : _client = client ?? http.Client(),
       _random = random ?? Random();

  final Directory directory;
  final String serverUrl;
  final String token;
  final Duration timeout;
  final Duration initialBackoff;
  final int maxQueue;

  /// Past this many pending files, recortes are skipped: envelopes come first.
  final int maxThumbnailBacklog;
  final http.Client _client;
  final Random _random;

  bool _running = false;
  Completer<void>? _wake;
  int _delivered = 0;
  int _retries = 0;
  String? _lastError;
  DateTime? _lastDeliveredAt;
  int _thumbnails = 0;
  int _thumbnailsDropped = 0;

  /// False once the central answers that it keeps no recortes.
  bool acceptsThumbnails = true;

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
    thumbnails: _thumbnails,
    thumbnailsDropped: _thumbnailsDropped,
    thumbnailsAccepted: acceptsThumbnails,
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

  /// Persists a track's recorte. It sorts right after the envelope numbered
  /// [sequenceNumber] ("~" follows the hex of an event id), so the central
  /// already knows the track when it arrives. Returns false when skipped.
  Future<bool> enqueueThumbnail({
    required String cameraId,
    required String sessionId,
    required int sequenceNumber,
    required int trackId,
    required String firstSeen,
    required Uint8List jpeg,
  }) async {
    if (!acceptsThumbnails) return false;
    await directory.create(recursive: true);
    if (_pendingFiles().length >= maxThumbnailBacklog) return false;
    final sequence = sequenceNumber.toString().padLeft(20, '0');
    final name = '${sessionId.substring(0, 8)}-$sequence-~thumb-$trackId.json';
    final temporary = File('${directory.path}/.$name.tmp');
    await temporary.writeAsString(
      jsonEncode({
        'kind': 'thumbnail',
        'cameraId': cameraId,
        'sessionId': sessionId,
        'trackId': trackId,
        'firstSeen': firstSeen,
        'jpeg': base64Encode(jpeg),
      }),
      flush: true,
    );
    await temporary.rename('${directory.path}/$name');
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
      Map<String, dynamic> item;
      try {
        body = await file.readAsString();
        item = jsonDecode(body) as Map<String, dynamic>;
      } on FormatException {
        await _reject(file, 'INVALID_JSON');
        continue;
      } on TypeError {
        await _reject(file, 'INVALID_JSON');
        continue;
      } on FileSystemException {
        continue; // Raced with a rename; look again.
      }
      final isThumbnail = item['kind'] == 'thumbnail';
      try {
        final response =
            await (isThumbnail
                    ? _postThumbnail(item)
                    : _post(
                        '/api/v1/ingest/detections',
                        'application/json',
                        body,
                      ))
                .timeout(timeout);
        if (isThumbnail &&
            response.statusCode >= 200 &&
            response.statusCode < 300) {
          await _remove(file);
          _thumbnails++;
          backoff = initialBackoff;
          continue;
        }
        if (isThumbnail &&
            (thumbnailDroppedCodes.contains(response.statusCode) ||
                response.statusCode == thumbnailsDisabledCode)) {
          await _remove(file);
          _thumbnailsDropped++;
          if (response.statusCode == thumbnailsDisabledCode) {
            acceptsThumbnails = false;
          }
          continue;
        }
        if (response.statusCode >= 200 && response.statusCode < 300) {
          await _remove(file);
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

  /// Deleting a file that is already gone (storage cleared while a request
  /// was in flight) must not stop the queue.
  Future<void> _remove(File file) async {
    try {
      await file.delete();
    } on PathNotFoundException {
      // Nothing left to remove.
    }
  }

  String get _base => serverUrl.replaceAll(RegExp(r'/+$'), '');

  Future<http.Response> _post(String path, String contentType, Object body) =>
      _client.post(
        Uri.parse('$_base$path'),
        headers: {
          'Content-Type': contentType,
          'X-Vigia-Device-Token': token,
          'User-Agent': 'vigia-edge-movil/1.1',
        },
        body: body,
      );

  Future<http.Response> _postThumbnail(Map<String, dynamic> item) {
    final query = Uri(
      queryParameters: {
        'cameraId': item['cameraId'] as String,
        'sessionId': item['sessionId'] as String,
        'trackId': '${item['trackId']}',
        'firstSeen': item['firstSeen'] as String,
      },
    ).query;
    return _post(
      '/api/v1/ingest/thumbnails?$query',
      'image/jpeg',
      base64Decode(item['jpeg'] as String),
    );
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
