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
  }) : lastSeen = firstSeen,
       lastCenter = firstCenter;

  final int id;
  final String label;
  final DateTime firstSeen;
  final (double, double) firstCenter;
  DateTime lastSeen;
  (double, double) lastCenter;
  Box box;
  double score;
  int misses = 0;

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
}

/// Greedy IoU tracker: enough for a fixed phone camera at a few fps. A track
/// survives short gaps (`maxMisses` frames) so a vehicle keeps one id.
class IouTracker {
  IouTracker({
    this.matchIou = 0.3,
    this.maxMisses = 6,
    this.retention = const Duration(seconds: 10),
  });

  final double matchIou;
  final int maxMisses;
  final Duration retention;
  final Map<int, Track> _tracks = {};
  int _nextId = 1;

  /// Tracks seen within the retention window (what a snapshot reports).
  List<Track> active(DateTime now) =>
      _tracks.values
          .where((track) => now.difference(track.lastSeen) <= retention)
          .toList(growable: false)
        ..sort((a, b) => a.id.compareTo(b.id));

  void update(List<Detection> detections, DateTime now) {
    final unmatched = [...detections]
      ..sort((a, b) => b.score.compareTo(a.score));
    final live = _tracks.values
        .where((track) => track.misses <= maxMisses)
        .toList();
    final matched = <int>{};
    for (final detection in [...unmatched]) {
      Track? best;
      var bestIou = matchIou;
      for (final track in live) {
        if (matched.contains(track.id) || track.label != detection.label) {
          continue;
        }
        final overlap = track.box.iou(detection.box);
        if (overlap >= bestIou) {
          best = track;
          bestIou = overlap;
        }
      }
      if (best != null) {
        matched.add(best.id);
        unmatched.remove(detection);
        best
          ..box = detection.box
          ..score = detection.score
          ..lastSeen = now
          ..lastCenter = detection.box.center
          ..misses = 0;
      }
    }
    for (final track in live) {
      if (!matched.contains(track.id)) track.misses++;
    }
    for (final detection in unmatched) {
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
  }
}
