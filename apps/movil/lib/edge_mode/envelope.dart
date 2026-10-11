import 'dart:math';

import 'tracker.dart';

const edgeNodeVersion = 'movil-1.1.0';

/// RFC 4122 version 4 identifier from a secure random source.
String uuidV4([Random? random]) {
  final generator = random ?? Random.secure();
  final bytes = List<int>.generate(16, (_) => generator.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-'
      '${hex.substring(16, 20)}-${hex.substring(20)}';
}

/// UTC with millisecond precision, like the PC node's `utc_now()`.
String _iso(DateTime value) => DateTime.fromMillisecondsSinceEpoch(
  value.millisecondsSinceEpoch,
  isUtc: true,
).toIso8601String();

/// Detection Envelope 1.1, byte-compatible with the PC vision node
/// (apps/vision/vigia_vision/events.py) so the backend treats both alike.
Map<String, dynamic> buildEnvelope({
  required String cameraId,
  required String sessionId,
  required int sequenceNumber,
  required int frameNumber,
  required String modelName,
  required String? modelDigest,
  required List<Track> tracks,
  DateTime? generatedAt,
  String? eventId,
}) => {
  'schemaVersion': '1.1',
  'eventId': eventId ?? uuidV4(),
  'sessionId': sessionId,
  'sequenceNumber': sequenceNumber,
  'cameraId': cameraId,
  'generatedAt': _iso(generatedAt ?? DateTime.now()),
  'nodeVersion': edgeNodeVersion,
  'model': modelName,
  'modelVersion': modelName,
  'modelDigest': modelDigest,
  'frameNumber': frameNumber,
  'detections': [
    for (final track in tracks)
      {
        'trackId': track.id,
        'vehicleType': track.label,
        'confidence': double.parse(track.score.toStringAsFixed(4)),
        'firstSeen': _iso(track.firstSeen),
        'lastSeen': _iso(track.lastSeen),
        'direction': track.direction,
        'boundingBox': track.box.toList(),
        'color': null,
        'make': null,
        'model': null,
        // Filled by the future plate stage; the contract already carries it.
        'licensePlate': null,
      },
  ],
};
