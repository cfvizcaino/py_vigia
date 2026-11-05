import { describe, expect, jest, test } from '@jest/globals';

import { EdgeEngine } from './engine';
import { Outbox } from './outbox';
import type { OutboxStorage, QueueFile, ThumbnailItem } from './outbox';
import type { FrameProcessingResult } from '../native/FrameProcessor';
import type { Box } from './types';

jest.mock('expo-crypto', () => ({
  getRandomBytes: (length: number) => new Uint8Array(length).fill(7),
}));

function fakeOutbox(acceptsThumbnails = true) {
  const envelopes: unknown[] = [];
  const thumbnails: ThumbnailItem[] = [];
  const outbox = {
    thumbnailsAccepted: acceptsThumbnails,
    start: jest.fn(),
    stop: jest.fn(async () => undefined),
    getStatus: jest.fn(async () => null),
    enqueue: jest.fn(async (envelope: unknown) => {
      envelopes.push(envelope);
      return true;
    }),
    enqueueThumbnail: jest.fn(async (item: ThumbnailItem) => {
      thumbnails.push(item);
      return true;
    }),
  };
  return { outbox: outbox as unknown as Outbox, envelopes, thumbnails };
}

function frame(box: Box, withThumbnail = true): FrameProcessingResult {
  return {
    detections: [{ box, score: 0.9, label: 'car' }],
    colorVotes: [null],
    colorFailureCount: 0,
    elapsedMs: 20,
    frameNumber: Date.now(),
    frameSize: { width: 640, height: 480 },
    thumbnail: withThumbnail ? { rgb: new Uint8Array(3), width: 1, height: 1, detectionIndex: 0 } : null,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 2));

describe('recortes por vehículo', () => {
  test('codifica la vista más grande, solo cuando crece, y la encola tras el sobre', async () => {
    const { outbox, envelopes, thumbnails } = fakeOutbox();
    const encode = jest.fn(async () => new Uint8Array([0xff, 0xd8, 0xff]));
    const gates: unknown[] = [];
    const engine = new EdgeEngine(
      { cameraId: 'CEL-02', serverUrl: 'https://vigia.example', token: 't' },
      { name: 'vehicles', digest: 'abc' },
      outbox,
      () => undefined,
      encode,
      (value) => gates.push(value),
    );
    engine.start();

    engine.process(frame({ x1: 0, y1: 0, x2: 100, y2: 100 }));
    await flush();
    expect(encode).not.toHaveBeenCalled(); // Un solo hit: el track aún no está confirmado.

    engine.process(frame({ x1: 2, y1: 0, x2: 102, y2: 100 }));
    await flush();
    expect(encode).toHaveBeenCalledTimes(1);

    engine.process(frame({ x1: 4, y1: 0, x2: 106, y2: 102 }));
    await flush();
    expect(encode).toHaveBeenCalledTimes(1); // Creció menos de 20 %.

    engine.process(frame({ x1: 4, y1: 0, x2: 134, y2: 120 }));
    await flush();
    expect(encode).toHaveBeenCalledTimes(2);
    expect(gates.at(-1)).toEqual([{ box: { x1: 4, y1: 0, x2: 134, y2: 120 }, minArea: 130 * 120 * 1.2 }]);

    await engine.stop();
    expect(envelopes).toHaveLength(1);
    expect(thumbnails).toHaveLength(1);
    expect(thumbnails[0]).toMatchObject({ cameraId: 'CEL-02', trackId: 1, sequenceNumber: 1 });
    expect(thumbnails[0]?.firstSeen).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test('no pide recortes si el centro no los guarda (501)', async () => {
    const { outbox } = fakeOutbox(false);
    const encode = jest.fn(async () => new Uint8Array([1]));
    const gates: unknown[] = [];
    const engine = new EdgeEngine(
      { cameraId: 'CEL-02', serverUrl: 'https://vigia.example', token: 't' },
      { name: 'vehicles', digest: 'abc' },
      outbox,
      () => undefined,
      encode,
      (value) => gates.push(value),
    );
    engine.start();
    engine.process(frame({ x1: 0, y1: 0, x2: 100, y2: 100 }));
    engine.process(frame({ x1: 0, y1: 0, x2: 100, y2: 100 }));
    await flush();
    await engine.stop();
    expect(encode).not.toHaveBeenCalled();
    expect(gates.at(-1)).toBeNull();
  });
});

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
      occupied.engine.process({ detections: [detection], colorVotes: [null], colorFailureCount: 0, elapsedMs: 4, frameNumber: 1, frameSize: { width: 100, height: 100 }, thumbnail: null });
      await jest.advanceTimersByTimeAsync(100);
      occupied.engine.process({ detections: [detection], colorVotes: [null], colorFailureCount: 0, elapsedMs: 4, frameNumber: 2, frameSize: { width: 100, height: 100 }, thumbnail: null });
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
      frameSize: { width: 100, height: 100 },
      thumbnail: null,
    });
    expect(engine.stats).toMatchObject({ failures: 1, framesProcessed: 1 });
    await engine.stop();
  });
});
