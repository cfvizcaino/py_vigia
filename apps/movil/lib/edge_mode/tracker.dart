import 'dart:math' as math;
import 'dart:typed_data';

import 'colors.dart';
import 'detections.dart';

/// One tracked vehicle, mirroring the vision node's TrackState.
class Track {
  Track({
    required this.id,
    required this.label,
    required this.firstSeen,
    required this.firstCenter,
    required this.box,
    required this.score,
  }) : firstBox = box,
       lastSeen = firstSeen,
       lastCenter = firstCenter,
       bestScore = score;

  final int id;
  final String label;
  final DateTime firstSeen;
  final (double, double) firstCenter;
  final Box firstBox;
  DateTime lastSeen;
  (double, double) lastCenter;
  Box box;

  /// Score in the latest frame (overlay) and the best one seen (published, as
  /// the PC node does: a vehicle kept alive by weak detections stays reported
  /// with the confidence it reached).
  double score;
  double bestScore;

  /// Frames matched; a track is published from [IouTracker.minHits] on.
  int hits = 1;

  /// Centre velocity in pixels per second, smoothed.
  double vx = 0;
  double vy = 0;
  final colorVotes = ColorVotes();

  /// Largest view so far as JPEG, for an admin to confirm the detection. Sent
  /// once, after the envelope that publishes the track (EdgeEngine).
  Uint8List? thumbnail;
  double thumbnailArea = 0;
  int thumbnailEncodes = 0;
  bool thumbnailQueued = false;

  /// Voted colour, or null while unknown.
  String? get color => colorVotes.color;

  /// Same rule as the edge node: dominant displacement, 25 px dead zone.
  String get direction {
    final dx = lastCenter.$1 - firstCenter.$1;
    final dy = lastCenter.$2 - firstCenter.$2;
    if (dx.abs() < 25 && dy.abs() < 25) return 'indeterminada';
    if (dx.abs() >= dy.abs()) {
      return dx > 0 ? 'izquierda-a-derecha' : 'derecha-a-izquierda';
    }
    return dy > 0 ? 'arriba-a-abajo' : 'abajo-a-arriba';
  }

  /// Where the box should be at [now] if the vehicle kept its velocity
  /// (at most 2 s ahead, so a long-lost track does not drift away).
  Box predicted(DateTime now) {
    final seconds = math.min(
      2.0,
      now.difference(lastSeen).inMicroseconds / 1e6,
    );
    final dx = vx * seconds;
    final dy = vy * seconds;
    return Box(box.x1 + dx, box.y1 + dy, box.x2 + dx, box.y2 + dy);
  }

  void _observe(Detection detection, DateTime now) {
    final seconds = now.difference(lastSeen).inMicroseconds / 1e6;
    final center = detection.box.center;
    if (seconds > 0) {
      final ix = (center.$1 - lastCenter.$1) / seconds;
      final iy = (center.$2 - lastCenter.$2) / seconds;
      vx = hits == 1 ? ix : vx * 0.5 + ix * 0.5;
      vy = hits == 1 ? iy : vy * 0.5 + iy * 0.5;
    }
    box = detection.box;
    score = detection.score;
    bestScore = math.max(bestScore, detection.score);
    lastSeen = now;
    lastCenter = center;
    hits++;
  }
}

/// ByteTrack-style tracker for a fixed phone camera at a few analyses per
/// second (apps/vision uses Ultralytics' ByteTrack with the same thresholds):
///
/// 1. Strong detections (≥ [highThresh]) are matched to every track, including
///    ones lost for up to [retention], against the last and the predicted box.
/// 2. Weak detections ([detectorFloor]–[highThresh]) only keep tracks seen in
///    the previous update alive: a distant car whose score dips is not lost.
/// 3. Unmatched strong detections (≥ [newThresh]) start tentative tracks, which
///    are published only after [minHits] matches and dropped if the next
///    update misses them. One-frame flickers never become vehicles.
///
/// Without this, a vehicle that dipped under the threshold for a second was
/// recreated with a new id: ~100 tracks for ~30 vehicles in a minute of video.
class IouTracker {
  IouTracker({
    this.highThresh = 0.35,
    this.newThresh = 0.35,
    this.matchIou = 0.2,
    this.minHits = 2,
    this.retention = const Duration(seconds: 10),
  });

  /// Lowest detector score the tracker consumes (step 2 needs weak ones).
  static const detectorFloor = 0.1;

  final double highThresh;
  final double newThresh;
  final double matchIou;
  final int minHits;
  final Duration retention;
  final Map<int, Track> _tracks = {};
  DateTime? _lastUpdate;
  int _nextId = 1;

  /// Confirmed tracks seen within the retention window (what a snapshot reports).
  List<Track> active(DateTime now) =>
      _tracks.values
          .where(
            (track) =>
                track.hits >= minHits &&
                now.difference(track.lastSeen) <= retention,
          )
          .toList(growable: false)
        ..sort((a, b) => a.id.compareTo(b.id));

  void update(List<Detection> detections, DateTime now) {
    final live = _tracks.values
        .where((track) => now.difference(track.lastSeen) <= retention)
        .toList();
    final strong = [
      for (final d in detections)
        if (d.score >= highThresh) d,
    ];
    final weak = [
      for (final d in detections)
        if (d.score >= detectorFloor && d.score < highThresh) d,
    ];

    final matched = <Track>{};
    final unmatchedStrong = _associate(live, strong, now, matched);
    final previous = _lastUpdate;
    final tracked = [
      for (final track in live)
        if (!matched.contains(track) && track.lastSeen == previous) track,
    ];
    _associate(tracked, weak, now, matched);

    // Tentative tracks get one chance: matched in the very next update or gone.
    _tracks.removeWhere(
      (_, track) => track.hits < minHits && !matched.contains(track),
    );
    for (final detection in unmatchedStrong) {
      if (detection.score < newThresh) continue;
      final id = _nextId++;
      _tracks[id] = Track(
        id: id,
        label: detection.label,
        firstSeen: now,
        firstCenter: detection.box.center,
        box: detection.box,
        score: detection.score,
      );
    }
    _tracks.removeWhere(
      (_, track) => now.difference(track.lastSeen) > retention,
    );
    _lastUpdate = now;
  }

  /// Greedy matching by best overlap (with the last or the predicted box),
  /// same label only. Updates matched tracks; returns unmatched detections.
  List<Detection> _associate(
    List<Track> tracks,
    List<Detection> detections,
    DateTime now,
    Set<Track> matched,
  ) {
    final pairs = <(double, Track, Detection)>[];
    for (final track in tracks) {
      if (matched.contains(track)) continue;
      final predicted = track.predicted(now);
      for (final detection in detections) {
        if (track.label != detection.label) continue;
        final overlap = math.max(
          track.box.iou(detection.box),
          predicted.iou(detection.box),
        );
        if (overlap >= matchIou) pairs.add((overlap, track, detection));
      }
    }
    pairs.sort((a, b) => b.$1.compareTo(a.$1));
    final used = <Detection>{};
    for (final (_, track, detection) in pairs) {
      if (matched.contains(track) || used.contains(detection)) continue;
      track._observe(detection, now);
      matched.add(track);
      used.add(detection);
    }
    return [
      for (final d in detections)
        if (!used.contains(d)) d,
    ];
  }
}
