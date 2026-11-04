import { describe, expect, jest, test } from '@jest/globals';

import { EdgeEngine } from './engine';
import { Outbox } from './outbox';
import type { OutboxStorage, QueueFile } from './outbox';

class StoredFile implements QueueFile {
  constructor(readonly name: string, private readonly files: Map<string, string>) {}

  async read(): Promise<string> {
    const value = this.files.get(this.name);
    if (value === undefined) throw new Error('Queue file missing.');
    return value;
  }

  async remove(): Promise<void> {
    this.files.delete(this.name);
  }

  async reject(): Promise<void> {
    this.files.delete(this.name);
  }
}

class StoredQueue implements OutboxStorage {
  readonly files = new Map<string, string>();

  async listPending(): Promise<QueueFile[]> {
    return [...this.files.keys()].sort().map((name) => new StoredFile(name, this.files));
  }

  async writeAtomically(name: string, value: string): Promise<void> {
    this.files.set(name, value);
  }

  async countRejected(): Promise<number> {
    return 0;
  }
}

function createEngine() {
  const requests: Record<string, unknown>[] = [];
  const outbox = new Outbox({
    storage: new StoredQueue(),
    serverUrl: 'https://vigia.example',
    token: 'edge-token',
    fetcher: async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(null, { status: 202 });
    },
    initialBackoffMs: 1,
  });
  const engine = new EdgeEngine(
    { cameraId: 'CEL-01', serverUrl: 'https://vigia.example', token: 'edge-token' },
    { name: 'vehicles', digest: 'a'.repeat(64) },
    outbox,
    () => undefined,
  );
  return { engine, requests };
}

describe('motor Edge', () => {
  test('publica heartbeat vacío a los 30 s y snapshots con vehículos a los 2 s', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
    try {
      const empty = createEngine();
      empty.engine.start();
      await jest.advanceTimersByTimeAsync(29_999);
      expect(empty.requests).toHaveLength(0);
      await jest.advanceTimersByTimeAsync(1);
      expect(empty.requests).toHaveLength(1);
      expect(empty.requests[0]?.detections).toEqual([]);
      await empty.engine.stop();

      jest.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
      const occupied = createEngine();
      occupied.engine.start();
      const detection = { box: { x1: 20, y1: 30, x2: 80, y2: 90 }, score: 0.9, label: 'car' as const };
      occupied.engine.process({ detections: [detection], colorVotes: [null], colorFailureCount: 0, elapsedMs: 4, frameNumber: 1 });
      await jest.advanceTimersByTimeAsync(100);
      occupied.engine.process({ detections: [detection], colorVotes: [null], colorFailureCount: 0, elapsedMs: 4, frameNumber: 2 });
      await jest.advanceTimersByTimeAsync(1_900);
      expect(occupied.requests).toHaveLength(1);
      expect(occupied.requests[0]?.detections).toHaveLength(1);
      await occupied.engine.stop();
    } finally {
      jest.useRealTimers();
    }
  });

  test('registra fallos sin impedir el procesamiento posterior', async () => {
    const { engine } = createEngine();
    engine.start();
    engine.reportError('fallo de inferencia');
    engine.process({
      detections: [],
      colorVotes: [],
      colorFailureCount: 0,
      elapsedMs: 8,
      frameNumber: 1,
    });
    expect(engine.stats).toMatchObject({ failures: 1, framesProcessed: 1 });
    await engine.stop();
  });
});
