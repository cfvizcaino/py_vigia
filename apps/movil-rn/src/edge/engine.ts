import * as Crypto from 'expo-crypto';

import { buildEnvelope, isoUtc, uuidV4 } from './envelope';
import { Outbox } from './outbox';
import { IouTracker } from './tracker';
import { ColorVotes } from './colors';
import type { ColorGate, FrameProcessingResult, PlateGate, StageTimings, ThumbnailGate } from '../native/FrameProcessor';
import type { OutboxStatus } from './outbox';
import type { ThumbnailPixels } from './preprocess';
import type { Track } from './tracker';
import type { Box } from './types';

/** Encodes a recorte's RGB pixels as JPEG (natively on the phone). */
export type EncodeThumbnail = (pixels: ThumbnailPixels) => Promise<Uint8Array>;

/** A recorte is re-taken only when the box grows this much, at most this many times per track. */
export const thumbnailGrowth = 1.2;
export const maxThumbnailEncodes = 4;
/** The view stops improving once the vehicle has been gone this long, or in view this long. */
export const thumbnailSettleMs = 1000;
export const thumbnailMaxWaitMs = 10_000;
/**
 * Colour gates are read by the next frame, ~100–400 ms later: a track whose
 * next vote is due within this margin is already offered, so the vote is not
 * pushed back a whole frame.
 */
export const colorGateLookaheadMs = 200;
/** A vehicle is searched again for its plate when its box grew this much, or after this long. */
export const plateViewGrowth = 1.15;
export const plateRetryMs = 800;

/** Vehicles seen in the latest frame, for the boxes drawn over the preview. */
export interface EdgeOverlay {
  frameWidth: number;
  frameHeight: number;
  tracks: { id: number; box: Box; label: string; color: string | null; plate: string | null; score: number }[];
}

/** p50 / p95 in milliseconds over the latest frames. */
export interface Percentiles {
  p50: number;
  p95: number;
}

/** Where a frame's time goes, over the latest [timingWindow] frames. */
export interface TimingSummary {
  samples: number;
  total: Percentiles;
  prepare: Percentiles;
  detect: Percentiles;
  decode: Percentiles;
  color: Percentiles;
  thumbnail: Percentiles;
  /** Frames with a plate attempt only. */
  plate: Percentiles;
  /** From the worklet finishing to the engine receiving the result. */
  handoff: Percentiles;
  colorCropsPerFrame: number;
}

export const timingWindow = 50;

/** How the plate search is going, for the status card. */
export interface PlateStats {
  /** Plate models loaded (the camera then runs at high resolution). */
  enabled: boolean;
  /** Vehicles searched, plates found too small (< 45 px), plates read by the OCR. */
  attempts: number;
  small: number;
  reads: number;
  /** Vehicles whose plate was voted (a text repeated). */
  voted: number;
  /** Widest plate seen, in camera pixels: tells whether the camera is close enough. */
  widestPx: number;
  /** Camera frame size actually delivered. */
  cameraSize: { width: number; height: number } | null;
}

export function percentiles(values: number[]): Percentiles {
  if (!values.length) return { p50: 0, p95: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return { p50: Math.round(at(0.5)), p95: Math.round(at(0.95)) };
}

export interface EdgeStats {
  framesProcessed: number;
  fps: number;
  inferenceMs: number;
  activeTracks: number;
  snapshots: number;
  outbox: OutboxStatus | null;
  failures: number;
  colorFailures: number;
  thumbnailFailures: number;
  overlay: EdgeOverlay | null;
  timings: TimingSummary | null;
  plates: PlateStats;
  lastError: string | null;
}

export class EdgeEngine {
  readonly sessionId = uuidV4(Crypto.getRandomBytes(16));
  readonly tracker = new IouTracker();
  private sequence = 0;
  private frameCount = 0;
  private inferenceMs = 0;
  private fps = 0;
  private previousFrameAt: number | null = null;
  private lastSnapshotAt: number | null = null;
  private failures = 0;
  private colorFailures = 0;
  private thumbnailFailures = 0;
  private overlay: EdgeOverlay | null = null;
  private readonly recentTimings: (StageTimings & { handoff: number })[] = [];
  private timingSummary: TimingSummary | null = null;
  private readonly plateStats: PlateStats = { enabled: false, attempts: 0, small: 0, reads: 0, voted: 0, widestPx: 0, cameraSize: null };
  private readonly votedPlateTracks = new Set<number>();
  private lastError: string | null = null;
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private snapshotInProgress: Promise<void> | null = null;
  private stopping = false;
  private outboxStatus: OutboxStatus | null = null;

  constructor(
    readonly config: { cameraId: string; serverUrl: string; token: string },
    readonly model: { name: string; digest: string },
    private readonly outbox: Outbox,
    private readonly onStatus: (stats: EdgeStats) => void,
    private readonly encodeThumbnail: EncodeThumbnail | null = null,
    private readonly onThumbnailGates: (gates: ThumbnailGate[] | null) => void = () => undefined,
    private readonly onColorGates: (gates: ColorGate[]) => void = () => undefined,
    private readonly onPlateGates: ((gates: PlateGate[]) => void) | null = null,
  ) {
    this.plateStats.enabled = onPlateGates !== null;
  }

  get running(): boolean {
    return this.snapshotTimer !== null;
  }

  get stats(): EdgeStats {
    return {
      framesProcessed: this.frameCount,
      fps: this.fps,
      inferenceMs: this.inferenceMs,
      activeTracks: this.tracker.active(Date.now()).length,
      snapshots: this.sequence,
      outbox: this.outboxStatus,
      failures: this.failures,
      colorFailures: this.colorFailures,
      thumbnailFailures: this.thumbnailFailures,
      overlay: this.overlay,
      timings: this.timingSummary,
      plates: { ...this.plateStats },
      lastError: this.lastError,
    };
  }

  start(): void {
    if (this.running) return;
    this.stopping = false;
    this.lastSnapshotAt = Date.now();
    this.outbox.start();
    this.snapshotTimer = setInterval(() => void this.snapshot(), 250);
    this.statusTimer = setInterval(() => void this.refreshStatus(), 500);
    void this.refreshStatus();
  }

  process(result: FrameProcessingResult): void {
    if (!this.running || this.stopping) return;
    const now = Date.now();
    const matches = this.tracker.update(result.detections, now);
    for (let index = 0; index < matches.length; index++) {
      const track = matches[index];
      const vote = result.colorVotes[index];
      // The frame only classified tracks offered as colour gates, so the
      // timing was already checked there; a full ballot still ignores it.
      if (track && vote && track.colorVotes.votes < ColorVotes.maxVotes) track.colorVotes.add(vote, now);
    }
    this.frameCount++;
    this.inferenceMs = result.elapsedMs;
    if (result.timings) this.recordTimings(result.timings, Date.now());
    const previous = this.previousFrameAt;
    if (previous !== null && now > previous) {
      const instantFps = 1000 / (now - previous);
      this.fps = this.fps === 0 ? instantFps : this.fps * 0.8 + instantFps * 0.2;
    }
    this.previousFrameAt = now;
    this.lastError = result.colorFailureCount ? `${result.colorFailureCount} fallos al clasificar color.` : null;
    this.colorFailures += result.colorFailureCount;
    if (result.cameraSize) this.plateStats.cameraSize = result.cameraSize;
    if (result.plate) {
      const track = matches[result.plate.detectionIndex];
      if (track) this.recordPlate(track, result.plate, now);
    }
    const thumbnail = result.thumbnail;
    if (thumbnail) {
      const track = matches[thumbnail.detectionIndex];
      if (track) void this.sampleThumbnail(track, thumbnail);
    }
    this.updateThumbnailGates(now);
    this.updateColorGates(now);
    this.updatePlateGates(now);
    this.overlay = {
      frameWidth: result.frameSize.width,
      frameHeight: result.frameSize.height,
      tracks: this.tracker.active(now)
        .filter((track) => track.lastSeen === now)
        .map((track) => ({
          id: track.id,
          box: track.box,
          label: track.label,
          color: track.colorVotes.color,
          plate: track.plateReads.plate,
          score: track.score,
        })),
    };
    this.publishStatus();
  }

  private recordTimings(timings: StageTimings, receivedAt: number): void {
    this.recentTimings.push({ ...timings, handoff: Math.max(0, receivedAt - timings.finishedAt) });
    if (this.recentTimings.length > timingWindow) this.recentTimings.shift();
    const column = (key: 'total' | 'prepare' | 'detect' | 'decode' | 'color' | 'thumbnail' | 'handoff') =>
      percentiles(this.recentTimings.map((sample) => sample[key]));
    const plateFrames = this.recentTimings.filter((sample) => (sample.plate ?? 0) > 0);
    const crops = this.recentTimings.reduce((sum, sample) => sum + sample.colorCrops, 0);
    this.timingSummary = {
      samples: this.recentTimings.length,
      total: column('total'),
      prepare: column('prepare'),
      detect: column('detect'),
      decode: column('decode'),
      color: column('color'),
      thumbnail: column('thumbnail'),
      plate: percentiles(plateFrames.map((sample) => sample.plate ?? 0)),
      handoff: column('handoff'),
      colorCropsPerFrame: Math.round((crops / this.recentTimings.length) * 10) / 10,
    };
    // One line per window in the device log, to compare builds on the phone.
    if (this.frameCount % timingWindow === 0) {
      console.log('VIGIA-TIEMPOS', JSON.stringify(this.timingSummary));
      // Counts and sizes only: plate texts are personal data and never logged.
      if (this.plateStats.enabled) console.log('VIGIA-PLACAS', JSON.stringify(this.plateStats));
    }
  }

  private recordPlate(track: Track, plate: NonNullable<FrameProcessingResult['plate']>, now: number): void {
    const { attempt } = plate;
    track.plateReads.add(attempt, plate.areaPx, now);
    this.plateStats.attempts++;
    if (attempt.status === 'small') this.plateStats.small++;
    if (attempt.status === 'read') this.plateStats.reads++;
    if (attempt.status !== 'none') this.plateStats.widestPx = Math.max(this.plateStats.widestPx, attempt.widthPx);
    if (track.plateReads.plate && !this.votedPlateTracks.has(track.id)) {
      this.votedPlateTracks.add(track.id);
      this.plateStats.voted++;
    }
  }

  /**
   * Confirmed vehicles seen in this frame whose plate is still wanted, when
   * the view improved (box grew) or a while passed: fewest reads first, then
   * the biggest. The frame processor tries the first one that is wide enough.
   */
  private updatePlateGates(now: number): void {
    if (!this.onPlateGates) return;
    this.onPlateGates(
      this.tracker.active(now)
        .filter((track) => {
          if (track.lastSeen !== now || !track.plateReads.wantsRead()) return false;
          const reads = track.plateReads;
          return reads.lastAt === null
            || boxArea(track.box) >= reads.lastArea * plateViewGrowth
            || now - reads.lastAt >= plateRetryMs;
        })
        .sort((left, right) => left.plateReads.reads - right.plateReads.reads || boxArea(right.box) - boxArea(left.box))
        .map((track) => ({ box: track.predicted(now + colorGateLookaheadMs) })),
    );
  }

  /** Keeps the track's largest view: only when its box grew enough, a few encodes per track. */
  private async sampleThumbnail(track: Track, pixels: ThumbnailPixels): Promise<void> {
    const encode = this.encodeThumbnail;
    if (!encode || !this.outbox.thumbnailsAccepted) return;
    const area = boxArea(track.box);
    if (
      track.hits < this.tracker.minHits ||
      track.thumbnailQueued ||
      track.thumbnailEncodes >= maxThumbnailEncodes ||
      area < track.thumbnailArea * thumbnailGrowth
    ) {
      return;
    }
    track.thumbnailEncodes++;
    // Reserve the area now so the next frames do not encode the same view.
    const previousArea = track.thumbnailArea;
    track.thumbnailArea = area;
    try {
      const jpeg = await encode(pixels);
      if (!track.thumbnailQueued) track.thumbnail = jpeg;
    } catch (reason) {
      // Without a recorte the vehicle is still reported; it just cannot be confirmed by eye.
      track.thumbnailArea = previousArea;
      this.thumbnailFailures++;
      console.error('No fue posible codificar un recorte de Edge.', reason);
      this.lastError = 'No fue posible preparar un recorte; la detección continúa.';
    }
  }

  /** Tells the frame processor which tracks still want a better view. */
  private updateThumbnailGates(now: number): void {
    if (!this.encodeThumbnail || !this.outbox.thumbnailsAccepted) {
      this.onThumbnailGates(null);
      return;
    }
    this.onThumbnailGates(
      this.tracker.active(now).map((track) => ({
        box: track.box,
        minArea: track.thumbnailQueued || track.thumbnailEncodes >= maxThumbnailEncodes
          ? Number.MAX_VALUE
          : track.thumbnailArea * thumbnailGrowth,
      })),
    );
  }

  /**
   * Tells the frame processor which vehicles still need a colour vote, as in
   * Flutter: confirmed tracks seen in this frame, big enough to classify,
   * fewest votes first. Before, every frame classified its first three
   * detections, weak ones and already-decided vehicles included.
   */
  private updateColorGates(now: number): void {
    this.onColorGates(
      this.tracker.active(now)
        .filter((track) => track.lastSeen === now
          && track.box.x2 - track.box.x1 >= ColorVotes.minSidePx
          && track.box.y2 - track.box.y1 >= ColorVotes.minSidePx
          && track.colorVotes.wantsSample(now + colorGateLookaheadMs))
        .sort((left, right) => left.colorVotes.votes - right.colorVotes.votes)
        .map((track) => ({ box: track.predicted(now + colorGateLookaheadMs) })),
    );
  }

  /** Recortes go after the envelope that published their track, once the view stopped improving. */
  private async queueThumbnails(now: number, force: boolean): Promise<void> {
    for (const track of this.tracker.active(now)) {
      const jpeg = track.thumbnail;
      if (!jpeg || track.thumbnailQueued) continue;
      const settled =
        force ||
        track.thumbnailEncodes >= maxThumbnailEncodes ||
        now - track.lastSeen >= thumbnailSettleMs ||
        now - track.firstSeen >= thumbnailMaxWaitMs;
      if (!settled) continue;
      track.thumbnailQueued = true;
      track.thumbnail = null;
      await this.outbox.enqueueThumbnail({
        cameraId: this.config.cameraId,
        sessionId: this.sessionId,
        sequenceNumber: this.sequence,
        trackId: track.id,
        firstSeen: isoUtc(track.firstSeen),
        jpeg,
      });
    }
  }

  reportError(message: string): void {
    console.error('Fallo en el procesamiento de Edge.', message);
    this.failures++;
    this.lastError = 'No se pudo analizar el fotograma. Revisa la cámara y el registro.';
    this.publishStatus();
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.snapshotTimer = null;
    this.statusTimer = null;
    if (this.frameCount > 0) await this.snapshot(true);
    await this.outbox.stop();
    await this.refreshStatus();
  }

  private snapshot(force = false): Promise<void> {
    if (this.snapshotInProgress) return this.snapshotInProgress;
    const operation = this.writeSnapshot(force);
    this.snapshotInProgress = operation.finally(() => {
      this.snapshotInProgress = null;
    });
    return this.snapshotInProgress;
  }

  private async writeSnapshot(force: boolean): Promise<void> {
    if (this.stopping && !force) return;
    const now = Date.now();
    const active = this.tracker.active(now);
    const elapsed = this.lastSnapshotAt === null ? Number.POSITIVE_INFINITY : now - this.lastSnapshotAt;
    if (!force && elapsed < (active.length ? 2000 : 30_000)) return;
    this.lastSnapshotAt = now;
    this.sequence++;
    try {
      const envelope = buildEnvelope({
        cameraId: this.config.cameraId,
        sessionId: this.sessionId,
        sequenceNumber: this.sequence,
        frameNumber: this.frameCount,
        modelName: this.model.name,
        modelDigest: this.model.digest,
        tracks: active,
        generatedAt: now,
        eventId: uuidV4(Crypto.getRandomBytes(16)),
      });
      await this.outbox.enqueue(envelope);
      if (this.encodeThumbnail) await this.queueThumbnails(now, force);
    } catch (reason) {
      console.error('No fue posible guardar un evento de Edge.', reason);
      this.lastError = 'No fue posible guardar los eventos del edge.';
      this.publishStatus();
    }
    this.publishStatus();
  }

  private async refreshStatus(): Promise<void> {
    try {
      this.outboxStatus = await this.outbox.getStatus();
      this.publishStatus();
    } catch (reason) {
      console.error('No fue posible consultar el estado de sincronización de Edge.', reason);
      this.lastError = 'No fue posible consultar el estado de sincronización.';
      this.publishStatus();
    }
  }

  private publishStatus(): void {
    this.onStatus(this.stats);
  }
}

function boxArea(box: { x1: number; y1: number; x2: number; y2: number }): number {
  return Math.max(0, box.x2 - box.x1) * Math.max(0, box.y2 - box.y1);
}
