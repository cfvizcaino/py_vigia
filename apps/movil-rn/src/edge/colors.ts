export const colorNamesEs: Readonly<Record<string, string>> = {
  black: 'negro',
  blue: 'azul',
  brown: 'café',
  gray: 'gris',
  green: 'verde',
  red: 'rojo',
  white: 'blanco',
  yellow: 'amarillo',
};

export class ColorVotes {
  static readonly minSidePx = 24;
  static readonly maxVotes = 5;
  static readonly minVotes = 2;
  static readonly minConfidence = 0.5;
  static readonly sampleIntervalMs = 500;
  static readonly maxCropsPerFrame = 3;

  private readonly sums: Record<string, number> = {};
  votes = 0;
  lastAt: number | null = null;

  add(probabilities: Record<string, number>, now: number): void {
    for (const [name, value] of Object.entries(probabilities)) {
      this.sums[name] = (this.sums[name] ?? 0) + value;
    }
    this.votes++;
    this.lastAt = now;
  }

  get color(): string | null {
    if (this.votes < ColorVotes.minVotes) return null;
    let winner: string | null = null;
    let highest = Number.NEGATIVE_INFINITY;
    for (const [name, sum] of Object.entries(this.sums)) {
      if (sum > highest) {
        winner = name;
        highest = sum;
      }
    }
    return winner && highest / this.votes >= ColorVotes.minConfidence ? winner : null;
  }

  wantsSample(now: number): boolean {
    return this.votes < ColorVotes.maxVotes
      && (this.lastAt === null || now - this.lastAt >= ColorVotes.sampleIntervalMs);
  }
}
