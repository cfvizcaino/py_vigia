import { Directory, File, Paths } from 'expo-file-system';

import type { DetectionEnvelope } from './envelope';

export const eventRejectedCodes = new Set([400, 409, 413, 422]);
export const thumbnailDroppedCodes = new Set([400, 404, 409, 413, 415, 422]);
export const thumbnailsDisabledCode = 501;

export interface QueueFile {
  name: string;
  read(): Promise<string>;
  remove(): Promise<void>;
  reject(reason: string): Promise<void>;
}

export interface OutboxStorage {
  listPending(): Promise<QueueFile[]>;
  writeAtomically(name: string, value: string): Promise<void>;
  countRejected(): Promise<number>;
}

class ExpoQueueFile implements QueueFile {
  constructor(
    private readonly file: File,
    private readonly rejectedDirectory: Directory,
  ) {
    this.name = file.name;
  }

  readonly name: string;

  read(): Promise<string> {
    return this.file.text();
  }

  async remove(): Promise<void> {
    this.file.delete();
  }

  async reject(reason: string): Promise<void> {
    const name = this.name.replace(/\.json$/, `.${reason}.json`);
    this.rejectedDirectory.create({ intermediates: true, idempotent: true });
    await this.file.move(new File(this.rejectedDirectory, name));
  }
}

export class ExpoOutboxStorage implements OutboxStorage {
  private readonly directory: Directory;
  private readonly rejectedDirectory: Directory;

  constructor(cameraId: string) {
    const safeCamera = cameraId.replace(/[^A-Za-z0-9._-]/g, '_');
    this.directory = new Directory(Paths.document, 'edge_outbox', safeCamera);
    this.rejectedDirectory = new Directory(this.directory, 'rejected');
  }

  async listPending(): Promise<QueueFile[]> {
    if (!this.directory.exists) return [];
    return this.directory.list()
      .filter((entry): entry is File => entry instanceof File && entry.name.endsWith('.json'))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((file) => new ExpoQueueFile(file, this.rejectedDirectory));
  }

  async writeAtomically(name: string, value: string): Promise<void> {
    this.directory.create({ intermediates: true, idempotent: true });
    const temporary = new File(this.directory, `.${name}.tmp`);
    temporary.create({ intermediates: true, overwrite: true });
    await temporary.write(value);
    await temporary.move(new File(this.directory, name));
  }

  async countRejected(): Promise<number> {
    if (!this.rejectedDirectory.exists) return 0;
    return this.rejectedDirectory.list().filter((entry) => entry instanceof File).length;
  }
}

export interface OutboxStatus {
  pending: number;
  rejected: number;
  delivered: number;
  retries: number;
  lastError: string | null;
  lastDeliveredAt: string | null;
  thumbnails: number;
  thumbnailsDropped: number;
  thumbnailsAccepted: boolean;
}

export interface ThumbnailItem {
  cameraId: string;
  sessionId: string;
  sequenceNumber: number;
  trackId: number;
  firstSeen: string;
  jpeg: Uint8Array;
}

export class Outbox {
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private wakeCurrent: (() => void) | null = null;
  private delivered = 0;
  private retries = 0;
  private lastError: string | null = null;
  private lastDeliveredAt: string | null = null;
  private thumbnails = 0;
  private thumbnailsDropped = 0;
  private acceptsThumbnails = true;

  constructor(
    private readonly options: {
      storage: OutboxStorage;
      serverUrl: string;
      token: string;
      fetcher?: typeof fetch;
      timeoutMs?: number;
      initialBackoffMs?: number;
      maxQueue?: number;
      maxThumbnailBacklog?: number;
      random?: () => number;
      now?: () => number;
    },
  ) {}

  get status(): Promise<OutboxStatus> {
    return this.getStatus();
  }

  async getStatus(): Promise<OutboxStatus> {
    const [pending, rejected] = await Promise.all([
      this.options.storage.listPending(),
      this.options.storage.countRejected(),
    ]);
    return {
      pending: pending.length,
      rejected,
      delivered: this.delivered,
      retries: this.retries,
      lastError: this.lastError,
      lastDeliveredAt: this.lastDeliveredAt,
      thumbnails: this.thumbnails,
      thumbnailsDropped: this.thumbnailsDropped,
      thumbnailsAccepted: this.acceptsThumbnails,
    };
  }

  async enqueue(envelope: DetectionEnvelope): Promise<boolean> {
    const pending = await this.options.storage.listPending();
    if (pending.length >= (this.options.maxQueue ?? 10_000)) {
      this.lastError = 'OUTBOX_FULL';
      return false;
    }
    const sequence = String(envelope.sequenceNumber).padStart(20, '0');
    const session = envelope.sessionId.slice(0, 8);
    const name = `${session}-${sequence}-${envelope.eventId}.json`;
    await this.options.storage.writeAtomically(name, JSON.stringify(envelope));
    this.wake();
    return true;
  }

  async enqueueThumbnail(item: ThumbnailItem): Promise<boolean> {
    if (!this.acceptsThumbnails) return false;
    if (item.jpeg.byteLength > 64 * 1024) {
      this.thumbnailsDropped++;
      this.lastError = 'THUMBNAIL_TOO_LARGE';
      return false;
    }
    const pending = await this.options.storage.listPending();
    const queuedThumbnails = pending.filter((file) => file.name.includes('-~thumb-')).length;
    if (queuedThumbnails >= (this.options.maxThumbnailBacklog ?? 500)) return false;
    const sequence = String(item.sequenceNumber).padStart(20, '0');
    const name = `${item.sessionId.slice(0, 8)}-${sequence}-~thumb-${item.trackId}.json`;
    const data = {
      kind: 'thumbnail',
      cameraId: item.cameraId,
      sessionId: item.sessionId,
      trackId: item.trackId,
      firstSeen: item.firstSeen,
      jpeg: bytesToBase64(item.jpeg),
    };
    await this.options.storage.writeAtomically(name, JSON.stringify(data));
    this.wake();
    return true;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.wake();
    await this.loopPromise;
    this.loopPromise = null;
  }

  private async loop(): Promise<void> {
    let backoff = this.options.initialBackoffMs ?? 1000;
    while (this.running) {
      let file: QueueFile | undefined;
      try {
        file = (await this.options.storage.listPending())[0];
      } catch {
        this.lastError = 'STORAGE_LIST';
        this.retries++;
        await this.retry(backoff);
        backoff = Math.min(30_000, backoff * 2);
        continue;
      }
      if (!file) {
        await this.wait(5000);
        continue;
      }

      let item: Record<string, unknown>;
      let serialized: string;
      try {
        serialized = await file.read();
      } catch {
        this.lastError = 'STORAGE_READ';
        this.retries++;
        await this.retry(backoff);
        backoff = Math.min(30_000, backoff * 2);
        continue;
      }
      try {
        item = JSON.parse(serialized) as Record<string, unknown>;
        if (!item || typeof item !== 'object') throw new TypeError('Expected JSON object.');
      } catch {
        try {
          await file.reject('INVALID_JSON');
          this.lastError = 'REJECTED_INVALID_JSON';
        } catch {
          this.lastError = 'STORAGE_REJECT';
          this.retries++;
          await this.retry(backoff);
          backoff = Math.min(30_000, backoff * 2);
        }
        continue;
      }

      const isThumbnail = item.kind === 'thumbnail';
      try {
        const response = await this.post(item, isThumbnail);
        if (isThumbnail && isSuccess(response.status)) {
          await file.remove();
          this.thumbnails++;
          backoff = this.options.initialBackoffMs ?? 1000;
          continue;
        }
        if (isThumbnail && (thumbnailDroppedCodes.has(response.status) || response.status === thumbnailsDisabledCode)) {
          await file.remove();
          this.thumbnailsDropped++;
          if (response.status === thumbnailsDisabledCode) this.acceptsThumbnails = false;
          continue;
        }
        if (isSuccess(response.status)) {
          await file.remove();
          this.delivered++;
          this.lastDeliveredAt = new Date((this.options.now ?? Date.now)()).toISOString();
          this.lastError = null;
          backoff = this.options.initialBackoffMs ?? 1000;
          continue;
        }
        if (!isThumbnail && eventRejectedCodes.has(response.status)) {
          await file.reject(String(response.status));
          this.lastError = `REJECTED_${response.status}`;
          continue;
        }
        this.lastError = `HTTP_${response.status}`;
      } catch (error) {
        this.lastError = error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK';
      }
      this.retries++;
      await this.retry(backoff);
      backoff = Math.min(30_000, backoff * 2);
    }
  }

  private retry(backoff: number): Promise<void> {
    const random = this.options.random ?? Math.random;
    const delay = Math.round(backoff * (0.8 + random() * 0.4));
    return this.wait(delay);
  }

  private async post(item: Record<string, unknown>, isThumbnail: boolean): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
    const root = this.options.serverUrl.replace(/\/+$/, '');
    const fetcher = this.options.fetcher ?? fetch;
    try {
      if (!isThumbnail) {
        return await fetcher(`${root}/api/v1/ingest/detections`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'X-Vigia-Device-Token': this.options.token,
            'User-Agent': 'vigia-edge-movil/1.1',
          },
          body: JSON.stringify(item),
        });
      }
      if (typeof item.cameraId !== 'string' || typeof item.sessionId !== 'string'
        || typeof item.trackId !== 'number' || typeof item.firstSeen !== 'string'
        || typeof item.jpeg !== 'string') {
        throw new TypeError('El recorte de outbox está incompleto.');
      }
      const query = new URLSearchParams({
        cameraId: item.cameraId,
        sessionId: item.sessionId,
        trackId: String(item.trackId),
        firstSeen: item.firstSeen,
      });
      return await fetcher(`${root}/api/v1/ingest/thumbnails?${query}`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'image/jpeg',
          'X-Vigia-Device-Token': this.options.token,
          'User-Agent': 'vigia-edge-movil/1.1',
        },
        body: new Uint8Array(base64ToBytes(item.jpeg)).buffer,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wakeCurrent = null;
        resolve();
      }, milliseconds);
      this.wakeCurrent = () => {
        clearTimeout(timer);
        this.wakeCurrent = null;
        resolve();
      };
    });
  }

  private wake(): void {
    this.wakeCurrent?.();
  }
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    encoded += alphabet[first >> 2];
    encoded += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)];
    encoded += second === undefined ? '=' : alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)];
    encoded += third === undefined ? '=' : alphabet[third & 63];
  }
  return encoded;
}

function base64ToBytes(encoded: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = encoded.replace(/=+$/, '');
  const output = new Uint8Array(Math.floor(clean.length * 3 / 4));
  let buffer = 0;
  let bits = 0;
  let offset = 0;
  for (const character of clean) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new TypeError('El recorte de outbox no contiene base64 válido.');
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output[offset++] = (buffer >> bits) & 255;
    }
  }
  return output.subarray(0, offset);
}
