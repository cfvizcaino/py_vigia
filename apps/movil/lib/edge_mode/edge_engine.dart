import 'dart:async';

import '../camera_mode/frame_encoder.dart';
import 'colors.dart';
import 'detections.dart';
import 'envelope.dart';
import 'outbox.dart';
import 'tracker.dart';

typedef DetectFrame =
    Future<({List<Detection> detections, Duration elapsed})> Function(
      FrameData frame,
    );

/// Colour probabilities for each box of one frame, in order.
typedef ClassifyColors = Future<List<Map<String, double>>> Function(
  FrameData frame,
  List<Box> boxes,
);

class EdgeStats {
  const EdgeStats({
    required this.framesProcessed,
    required this.fps,
    required this.inferenceMs,
    required this.activeTracks,
    required this.snapshots,
    required this.outbox,
    this.failures = 0,
    this.colorFailures = 0,
    this.lastError,
  });

  final int framesProcessed;
  final double fps;
  final int inferenceMs;
  final int activeTracks;
  final int snapshots;
  final OutboxStatus outbox;

  /// Frames whose detection failed or timed out, and the latest reason.
  final int failures;
  final int colorFailures;
  final String? lastError;
}

/// True when the next envelope should be sent. Vehicles keep the short
/// interval; an empty scene waits for the idle one.
bool snapshotDue({
  required Duration elapsed,
  required bool hasVehicles,
  required Duration activeEvery,
  required Duration idleEvery,
}) => elapsed >= (hasVehicles ? activeEvery : idleEvery);

/// The PC node's loop, on the phone: frame → detect → track, and a snapshot to
/// the outbox every two seconds while vehicles are in view. With an empty
/// scene the heartbeat waits [idleSnapshotInterval] (30 s), same rule as the
/// PC node, so idle cameras do not fill the central database.
class EdgeEngine {
  EdgeEngine({
    required this.cameraId,
    required this.modelName,
    required this.modelDigest,
    required this.detect,
    required this.outbox,
    this.classifyColors,
    IouTracker? tracker,
    this.snapshotInterval = const Duration(seconds: 2),
    this.idleSnapshotInterval = const Duration(seconds: 30),
    this.detectTimeout = const Duration(seconds: 10),
    DateTime Function()? clock,
  }) : tracker = tracker ?? IouTracker(),
       _clock = clock ?? DateTime.now;

  final String cameraId;
  final String modelName;
  final String? modelDigest;
  final DetectFrame detect;
  final Outbox outbox;

  /// Null when the app ships no colour model: colours then stay unknown.
  final ClassifyColors? classifyColors;
  final IouTracker tracker;
  final Duration snapshotInterval;
  final Duration idleSnapshotInterval;
  final Duration detectTimeout;
  final DateTime Function() _clock;

  final String sessionId = uuidV4();
  int _sequence = 0;
  int _frames = 0;
  int _inferenceMs = 0;
  double _fps = 0;
  DateTime? _lastProcessed;
  bool _busy = false;
  int _failures = 0;
  int _colorFailures = 0;
  String? _lastError;
  Timer? _timer;
  DateTime? _lastSnapshotAt;
  List<Detection> latestDetections = const [];

  /// Tracks matched in the latest frame, with their voted colour (overlay).
  List<Track> latestTracks = const [];

  bool get running => _timer != null;
  bool get busy => _busy;

  EdgeStats get stats => EdgeStats(
    framesProcessed: _frames,
    fps: _fps,
    inferenceMs: _inferenceMs,
    activeTracks: tracker.active(_clock()).length,
    snapshots: _sequence,
    outbox: outbox.status,
    failures: _failures,
    colorFailures: _colorFailures,
    lastError: _lastError,
  );

  void start() {
    if (running) return;
    outbox.start();
    _timer = Timer.periodic(snapshotInterval, (_) => snapshot());
  }

  Future<void> stop() async {
    _timer?.cancel();
    _timer = null;
    if (_frames > 0) {
      await snapshot(force: true); // Final state, as the PC node does on shutdown.
    }
    outbox.stop();
  }

  /// Processes a frame unless the previous one is still running (frames are
  /// dropped, never queued, so the reported state is always fresh).
  Future<void> process(FrameData frame) async {
    if (_busy || !running) return;
    _busy = true;
    try {
      // A stuck frame must not freeze the node: give up and take the next one.
      final result = await detect(frame).timeout(detectTimeout);
      final now = _clock();
      tracker.update(result.detections, now);
      latestDetections = result.detections;
      _frames++;
      _inferenceMs = result.elapsed.inMilliseconds;
      final previous = _lastProcessed;
      if (previous != null) {
        final seconds = now.difference(previous).inMicroseconds / 1e6;
        if (seconds > 0) {
          _fps = _fps == 0 ? 1 / seconds : _fps * 0.8 + 0.2 / seconds;
        }
      }
      _lastProcessed = now;
      _lastError = null;
      await _sampleColors(frame, now);
      latestTracks = [
        for (final track in tracker.active(now))
          if (track.lastSeen == now) track,
      ];
    } on TimeoutException {
      _failures++;
      _lastError = 'La detección tardó más de ${detectTimeout.inSeconds} s.';
    } catch (error) {
      _failures++;
      _lastError = '$error';
    } finally {
      _busy = false;
    }
  }

  /// Adds a colour vote to the tracks seen in this frame that still need one,
  /// fewest votes first and a few crops at most, so detection keeps its pace.
  Future<void> _sampleColors(FrameData frame, DateTime now) async {
    final classify = classifyColors;
    if (classify == null) return;
    final pending =
        tracker
            .active(now)
            .where(
              (track) =>
                  track.lastSeen == now &&
                  track.box.width >= ColorVotes.minSidePx &&
                  track.box.height >= ColorVotes.minSidePx &&
                  track.colorVotes.wantsSample(now),
            )
            .toList()
          ..sort((a, b) => a.colorVotes.votes.compareTo(b.colorVotes.votes));
    final selected = pending.take(ColorVotes.maxCropsPerFrame).toList();
    if (selected.isEmpty) return;
    try {
      final probabilities = await classify(frame, [
        for (final track in selected) track.box,
      ]).timeout(detectTimeout);
      for (var i = 0; i < selected.length; i++) {
        selected[i].colorVotes.add(probabilities[i], now);
      }
    } catch (error) {
      // A colour failure must not cost the detection: the vehicle is still
      // reported, just without colour.
      _colorFailures++;
      _lastError = 'Color: $error';
    }
  }

  Future<void> snapshot({bool force = false}) async {
    final now = _clock();
    final active = tracker.active(now);
    final last = _lastSnapshotAt;
    if (!force &&
        last != null &&
        !snapshotDue(
          elapsed: now.difference(last),
          hasVehicles: active.isNotEmpty,
          activeEvery: snapshotInterval,
          idleEvery: idleSnapshotInterval,
        )) {
      return;
    }
    _lastSnapshotAt = now;
    _sequence++;
    await outbox.enqueue(
      buildEnvelope(
        cameraId: cameraId,
        sessionId: sessionId,
        sequenceNumber: _sequence,
        frameNumber: _frames,
        modelName: modelName,
        modelDigest: modelDigest,
        tracks: tracker.active(now),
        generatedAt: now,
      ),
    );
  }
}
