import { intersectionOverUnion } from './detections';
import { ColorVotes } from './colors';
import type { Box, Detection } from './types';

export class Track {
  readonly id: number;
  readonly label: Detection['label'];
  readonly firstSeen: number;
  readonly firstCenter: [number, number];
  lastSeen: number;
  lastCenter: [number, number];
  box: Box;
  score: number;
  bestScore: number;
  hits = 1;
  vx = 0;
  vy = 0;
  readonly colorVotes = new ColorVotes();

  constructor(id: number, detection: Detection, now: number) {
    this.id = id;
    this.label = detection.label;
    this.firstSeen = now;
    this.firstCenter = boxCenter(detection.box);
    this.lastSeen = now;
    this.lastCenter = this.firstCenter;
    this.box = detection.box;
    this.score = detection.score;
    this.bestScore = detection.score;
  }

  get direction(): string {
    const dx = this.lastCenter[0] - this.firstCenter[0];
    const dy = this.lastCenter[1] - this.firstCenter[1];
    if (Math.abs(dx) < 25 && Math.abs(dy) < 25) return 'indeterminada';
    if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'izquierda-a-derecha' : 'derecha-a-izquierda';
    return dy > 0 ? 'arriba-a-abajo' : 'abajo-a-arriba';
  }

  predicted(now: number): Box {
    const seconds = Math.min(2, Math.max(0, now - this.lastSeen) / 1000);
    const dx = this.vx * seconds;
    const dy = this.vy * seconds;
    return { x1: this.box.x1 + dx, y1: this.box.y1 + dy, x2: this.box.x2 + dx, y2: this.box.y2 + dy };
  }

  observe(detection: Detection, now: number): void {
    const seconds = (now - this.lastSeen) / 1000;
    const center = boxCenter(detection.box);
    if (seconds > 0) {
      const instantVx = (center[0] - this.lastCenter[0]) / seconds;
      const instantVy = (center[1] - this.lastCenter[1]) / seconds;
      this.vx = this.hits === 1 ? instantVx : this.vx * 0.5 + instantVx * 0.5;
      this.vy = this.hits === 1 ? instantVy : this.vy * 0.5 + instantVy * 0.5;
    }
    this.box = detection.box;
    this.score = detection.score;
    this.bestScore = Math.max(this.bestScore, detection.score);
    this.lastSeen = now;
    this.lastCenter = center;
    this.hits++;
  }
}

export class IouTracker {
  static readonly detectorFloor = 0.1;

  private readonly tracks = new Map<number, Track>();
  private lastUpdate: number | null = null;
  private nextId = 1;

  constructor(
    readonly highThreshold = 0.35,
    readonly newTrackThreshold = 0.35,
    readonly matchIou = 0.2,
    readonly minHits = 2,
    readonly retentionMs = 10_000,
  ) {}

  active(now: number): Track[] {
    return [...this.tracks.values()]
      .filter((track) => track.hits >= this.minHits && now - track.lastSeen <= this.retentionMs)
      .sort((left, right) => left.id - right.id);
  }

  update(detections: Detection[], now: number): (Track | null)[] {
    const live = [...this.tracks.values()].filter((track) => now - track.lastSeen <= this.retentionMs);
    const strong = detections.filter((detection) => detection.score >= this.highThreshold);
    const weak = detections.filter((detection) => detection.score >= IouTracker.detectorFloor && detection.score < this.highThreshold);
    const matched = new Set<Track>();
    const unmatchedStrong = this.associate(live, strong, now, matched);
    const recentUnmatched = live.filter((track) => !matched.has(track) && track.lastSeen === this.lastUpdate);
    this.associate(recentUnmatched, weak, now, matched);

    for (const [id, track] of this.tracks) {
      if (track.hits < this.minHits && !matched.has(track)) this.tracks.delete(id);
    }
    for (const detection of unmatchedStrong) {
      if (detection.score < this.newTrackThreshold) continue;
      const id = this.nextId++;
      this.tracks.set(id, new Track(id, detection, now));
    }
    for (const [id, track] of this.tracks) {
      if (now - track.lastSeen > this.retentionMs) this.tracks.delete(id);
    }
    this.lastUpdate = now;
    return detections.map((detection) => [...this.tracks.values()].find(
      (track) => track.lastSeen === now && track.box === detection.box,
    ) ?? null);
  }

  private associate(
    tracks: Track[],
    detections: Detection[],
    now: number,
    matched: Set<Track>,
  ): Detection[] {
    const pairs: { overlap: number; track: Track; detection: Detection }[] = [];
    for (const track of tracks) {
      if (matched.has(track)) continue;
      const predicted = track.predicted(now);
      for (const detection of detections) {
        if (track.label !== detection.label) continue;
        const overlap = Math.max(intersectionOverUnion(track.box, detection.box), intersectionOverUnion(predicted, detection.box));
        if (overlap >= this.matchIou) pairs.push({ overlap, track, detection });
      }
    }
    pairs.sort((left, right) => right.overlap - left.overlap);
    const used = new Set<Detection>();
    for (const pair of pairs) {
      if (matched.has(pair.track) || used.has(pair.detection)) continue;
      pair.track.observe(pair.detection, now);
      matched.add(pair.track);
      used.add(pair.detection);
    }
    return detections.filter((detection) => !used.has(detection));
  }
}

function boxCenter(box: Box): [number, number] {
  return [(box.x1 + box.x2) / 2, (box.y1 + box.y2) / 2];
}
