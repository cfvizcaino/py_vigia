import { describe, expect, test } from '@jest/globals';

import { Outbox } from './outbox';
import type { OutboxStorage, QueueFile } from './outbox';
import type { DetectionEnvelope } from './envelope';

class MemoryQueueFile implements QueueFile {
  constructor(
    readonly name: string,
    private readonly files: Map<string, string>,
    private readonly rejected: Map<string, string>,
  ) {}

  async read(): Promise<string> {
    const value = this.files.get(this.name);
    if (value === undefined) throw new Error('Queue file missing.');
    return value;
  }

  async remove(): Promise<void> {
    this.files.delete(this.name);
  }

  async reject(reason: string): Promise<void> {
    const value = await this.read();
    this.files.delete(this.name);
    this.rejected.set(this.name.replace(/\.json$/, `.${reason}.json`), value);
  }
}

class MemoryOutboxStorage implements OutboxStorage {
  readonly files = new Map<string, string>();
  readonly rejected = new Map<string, string>();

  async listPending(): Promise<QueueFile[]> {
    return [...this.files.keys()].sort().map((name) => new MemoryQueueFile(name, this.files, this.rejected));
  }

  async writeAtomically(name: string, value: string): Promise<void> {
    this.files.set(name, value);
  }

  async countRejected(): Promise<number> {
    return this.rejected.size;
  }
}

const envelope: DetectionEnvelope = {
  schemaVersion: '1.1',
  eventId: '4d38b920-6db0-4c48-9b68-967a1b8f94c0',
  sessionId: 'c053f859-273d-4c44-9093-39c4ea38f7c8',
  sequenceNumber: 1,
  cameraId: 'CEL-01',
  generatedAt: '2026-03-01T12:00:00.000Z',
  nodeVersion: 'movil-1.4.0',
  model: 'vehicles',
  modelVersion: 'vehicles',
  modelDigest: null,
  frameNumber: 0,
  detections: [],
};

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Outbox operation did not complete in time.');
}

describe('outbox persistente', () => {
  test('entrega por secuencia, acepta HTTP 202 y adjunta el token del dispositivo', async () => {
    const storage = new MemoryOutboxStorage();
    const delivered: number[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { sequenceNumber: number };
      delivered.push(body.sequenceNumber);
      expect(new Headers(init?.headers).get('X-Vigia-Device-Token')).toBe('edge-secret');
      return new Response(null, { status: 202 });
    };
    const outbox = new Outbox({
      storage,
      serverUrl: 'https://vigia.example',
      token: 'edge-secret',
      fetcher,
      initialBackoffMs: 1,
    });
    await outbox.enqueue({ ...envelope, sequenceNumber: 2, eventId: '4d38b920-6db0-4c48-9b68-967a1b8f94c2' });
    await outbox.enqueue(envelope);
    outbox.start();
    await waitFor(async () => delivered.length === 2 && (await outbox.getStatus()).pending === 0);
    await outbox.stop();
    expect(delivered).toEqual([1, 2]);
    expect(await outbox.getStatus()).toMatchObject({ delivered: 2, pending: 0 });
  });

  test('rechaza nuevos eventos cuando la cola está llena y persiste para una nueva instancia', async () => {
    const storage = new MemoryOutboxStorage();
    const queued = new Outbox({ storage, serverUrl: 'https://vigia.example', token: 'edge-secret', maxQueue: 1 });
    expect(await queued.enqueue(envelope)).toBe(true);
    expect(await queued.enqueue({
      ...envelope,
      sequenceNumber: 2,
      eventId: '4d38b920-6db0-4c48-9b68-967a1b8f94c2',
    })).toBe(false);
    expect(await queued.getStatus()).toMatchObject({ pending: 1, lastError: 'OUTBOX_FULL' });

    const restored = new Outbox({
      storage,
      serverUrl: 'https://vigia.example',
      token: 'edge-secret',
      fetcher: async () => new Response(null, { status: 202 }),
      initialBackoffMs: 1,
    });
    restored.start();
    await waitFor(async () => (await restored.getStatus()).pending === 0);
    await restored.stop();
    expect(await restored.getStatus()).toMatchObject({ delivered: 1, pending: 0 });
  });

  test('rechaza envelopes con 400 y conserva el evento en rechazados', async () => {
    const storage = new MemoryOutboxStorage();
    const fetcher: typeof fetch = async () => ({ ok: false, status: 400 } as Response);
    const outbox = new Outbox({ storage, serverUrl: 'https://vigia.example', token: 'edge-token', fetcher });
    await outbox.enqueue(envelope);
    outbox.start();
    await waitFor(() => storage.rejected.size === 1);
    await outbox.stop();
    expect(await outbox.getStatus()).toMatchObject({ pending: 0, rejected: 1, lastError: 'REJECTED_400' });
  });

  test('limita recortes a 64 KiB y a 500 elementos pendientes', async () => {
    const storage = new MemoryOutboxStorage();
    const outbox = new Outbox({
      storage,
      serverUrl: 'https://vigia.example',
      token: 'edge-token',
    });
    const thumbnail = {
      cameraId: 'CEL-01',
      sessionId: envelope.sessionId,
      sequenceNumber: 1,
      trackId: 0,
      firstSeen: envelope.generatedAt,
      jpeg: new Uint8Array([0xff, 0xd8, 0xff]),
    };
    for (let trackId = 0; trackId < 500; trackId++) {
      expect(await outbox.enqueueThumbnail({ ...thumbnail, trackId })).toBe(true);
    }
    expect(await outbox.enqueueThumbnail({ ...thumbnail, trackId: 500 })).toBe(false);
    expect(await outbox.enqueueThumbnail({ ...thumbnail, jpeg: new Uint8Array(64 * 1024 + 1) })).toBe(false);
    expect(await outbox.getStatus()).toMatchObject({ pending: 500, thumbnailsDropped: 1 });
  });
});
