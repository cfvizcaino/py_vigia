import * as Crypto from 'expo-crypto';

import { buildEnvelope, isoUtc, uuidV4 } from './envelope';
import { Outbox } from './outbox';
import { IouTracker } from './tracker';
import type { FrameProcessingResult, ThumbnailGate } from '../native/FrameProcessor';
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

/** Vehicles seen in the latest frame, for the boxes drawn over the preview. */
export interface EdgeOverlay {
  frameWidth: number;
  frameHeight: number;
  tracks: { id: number; box: Box; label: string; color: string | null; score: number }[];
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
  ) {}

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
      if (track && vote && track.colorVotes.wantsSample(now)) track.colorVotes.add(vote, now);
    }
    this.frameCount++;
    this.inferenceMs = result.elapsedMs;
    const previous = this.previousFrameAt;
    if (previous !== null && now > previous) {
      const instantFps = 1000 / (now - previous);
      this.fps = this.fps === 0 ? instantFps : this.fps * 0.8 + instantFps * 0.2;
    }
    this.previousFrameAt = now;
    this.lastError = result.colorFailureCount ? `${result.colorFailureCount} fallos al clasificar color.` : null;
    this.colorFailures += result.colorFailureCount;
    const thumbnail = result.thumbnail;
    if (thumbnail) {
      const track = matches[thumbnail.detectionIndex];
      if (track) void this.sampleThumbnail(track, thumbnail);
    }
    this.updateThumbnailGates(now);
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
          score: track.score,
        })),
    };
    this.publishStatus();
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
      this.lastError = `Recorte: ${reason instanceof Error ? reason.message : String(reason)}`;
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
    this.failures++;
    this.lastError = message;
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
      this.lastError = reason instanceof Error ? reason.message : 'No fue posible guardar el evento edge.';
      this.publishStatus();
    }
    this.publishStatus();
  }

  private async refreshStatus(): Promise<void> {
    try {
      this.outboxStatus = await this.outbox.getStatus();
      this.publishStatus();
    } catch (reason) {
      this.lastError = reason instanceof Error ? reason.message : 'No fue posible consultar la outbox.';
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
