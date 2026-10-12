// Runs the app's tracker over recorded detections and writes the tracks an edge
// would publish, for apps/vision/training/evaluate_tracking.py `metrics`.
//
//   dart run tool/track_report.dart detecciones.json tracks.json
//
// The detections come from `evaluate_tracking.py record` (320 px, ~6 analyses/s,
// scores down to 0.05) so the tracker sees what the phone's detector would.
import 'dart:convert';
import 'dart:io';

import 'package:movil/edge_mode/detections.dart';
import 'package:movil/edge_mode/tracker.dart';

void main(List<String> args) {
  if (args.length != 2) {
    stderr.writeln(
      'Uso: dart run tool/track_report.dart ENTRADA.json SALIDA.json',
    );
    exit(64);
  }
  final input =
      jsonDecode(File(args[0]).readAsStringSync()) as Map<String, dynamic>;
  final tracker = IouTracker();
  final start = DateTime.utc(2026);
  final reported = <int, Map<String, Object>>{};
  var strong = 0;
  var covered = 0;
  for (final frame in (input['frames'] as List).cast<Map<String, dynamic>>()) {
    final seconds = (frame['t'] as num).toDouble();
    final now = start.add(Duration(microseconds: (seconds * 1e6).round()));
    final detections = [
      for (final d
          in (frame['detections'] as List).cast<Map<String, dynamic>>())
        if ((d['score'] as num) >= IouTracker.detectorFloor)
          Detection(
            box: () {
              final b = (d['box'] as List).cast<num>();
              return Box(
                b[0].toDouble(),
                b[1].toDouble(),
                b[2].toDouble(),
                b[3].toDouble(),
              );
            }(),
            score: (d['score'] as num).toDouble(),
            label: d['label'] as String,
          ),
    ];
    tracker.update(detections, now);
    final published = [
      for (final track in tracker.active(now))
        if (track.lastSeen == now) track,
    ];
    // Coverage: strong detections that end up inside a published track.
    for (final d in detections.where((d) => d.score >= 0.35)) {
      strong++;
      if (published.any((t) => t.label == d.label && t.box.iou(d.box) >= 0.5)) {
        covered++;
      }
    }
    // What a snapshot would publish: the tracks the tracker reports as active.
    for (final track in published) {
      final box = [track.box.x1, track.box.y1, track.box.x2, track.box.y2];
      final entry = reported.putIfAbsent(
        track.id,
        () => {
          'id': track.id,
          'label': track.label,
          'first': seconds,
          'firstBox': box,
        },
      );
      entry['last'] = seconds;
      entry['lastBox'] = box;
    }
  }
  File(args[1]).writeAsStringSync('${jsonEncode(reported.values.toList())}\n');
  stdout.writeln(
    '${reported.length} tracks publicados; cobertura de detecciones ≥ 0,35: '
    '${(100 * covered / (strong == 0 ? 1 : strong)).toStringAsFixed(1)} % ($covered/$strong)',
  );
}
