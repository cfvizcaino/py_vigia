/// Vehicle colour: a classifier over each track's crop, voted across frames.
///
/// One frame lies (glare, shadow, blur), so a track adds up the probabilities of
/// several crops and only reports a colour when the average is clear. Otherwise
/// it stays null: "unknown" beats a wrong colour, because queries filter by
/// equality. Same rule as the PC node (apps/vision/vigia_vision/colors.py).
class ColorVotes {
  static const minSidePx = 24;
  static const maxVotes = 5;
  static const minVotes = 2;
  static const minConfidence = 0.5;
  static const reclassifyEvery = Duration(milliseconds: 500);
  static const maxCropsPerFrame = 3;

  final Map<String, double> _sums = {};
  int votes = 0;
  DateTime? lastAt;

  void add(Map<String, double> probabilities, DateTime now) {
    probabilities.forEach(
      (name, value) => _sums[name] = (_sums[name] ?? 0) + value,
    );
    votes++;
    lastAt = now;
  }

  String? get color {
    if (votes < minVotes || _sums.isEmpty) return null;
    final best = _sums.entries.reduce((a, b) => b.value > a.value ? b : a);
    return best.value / votes >= minConfidence ? best.key : null;
  }

  bool wantsSample(DateTime now) {
    final last = lastAt;
    return votes < maxVotes &&
        (last == null || now.difference(last) >= reclassifyEvery);
  }
}

/// Spanish names for the on-screen overlay.
const colorNamesEs = {
  'black': 'negro',
  'blue': 'azul',
  'brown': 'café',
  'gray': 'gris',
  'green': 'verde',
  'red': 'rojo',
  'white': 'blanco',
  'yellow': 'amarillo',
};
