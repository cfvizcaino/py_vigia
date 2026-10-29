import * as Crypto from 'expo-crypto';

import { buildEnvelope, uuidV4 } from './envelope';
import { Outbox } from './outbox';
import { IouTracker } from './tracker';
import type { FrameProcessingResult } from '../native/FrameProcessor';
import type { OutboxStatus } from './outbox';

export interface EdgeStats {
  framesProcessed: number;
  fps: number;
  inferenceMs: number;
  activeTracks: number;
  snapshots: number;
  outbox: OutboxStatus | null;
  failures: number;
  colorFailures: number;
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
    this.publishStatus();
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
