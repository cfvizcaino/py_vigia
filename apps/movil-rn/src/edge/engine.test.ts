import { describe, expect, jest, test } from '@jest/globals';

import { EdgeEngine, percentiles } from './engine';
import { buildEnvelope } from './envelope';
import { Track } from './tracker';
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

describe('color solo para vehículos que lo necesitan', () => {
  test('ofrece los tracks confirmados con menos votos y deja de ofrecerlos al completar la votación', () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const { outbox } = fakeOutbox(false);
    const gates: { box: Box }[][] = [];
    const engine = new EdgeEngine(
      { cameraId: 'CEL-03', serverUrl: 'https://vigia.example', token: 't' },
      { name: 'vehicles', digest: 'abc' },
      outbox,
      () => undefined,
      null,
      () => undefined,
      (value) => gates.push(value),
    );
    engine.start();
    const white = { white: 0.9, black: 0.1 };
    const tick = (votes: (Record<string, number> | null)[]) => {
      engine.process({ ...frame({ x1: 0, y1: 0, x2: 100, y2: 100 }, false), colorVotes: votes });
      jest.advanceTimersByTime(600);
    };

    tick([null]);
    expect(gates.at(-1)).toEqual([]); // Un solo hit: aún no confirmado.
    tick([null]);
    expect(gates.at(-1)).toHaveLength(1);
    for (let vote = 0; vote < 5; vote++) tick([white]);
    expect(gates.at(-1)).toEqual([]); // Cinco votos: el color ya está decidido.
    expect(engine.stats.overlay?.tracks[0]?.color).toBe('white');
    void engine.stop();
    jest.useRealTimers();
  });
});

describe('tiempos por etapa', () => {
  test('percentiles p50 y p95', () => {
    const values = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(percentiles(values)).toEqual({ p50: 51, p95: 96 });
    expect(percentiles([])).toEqual({ p50: 0, p95: 0 });
  });

  test('resume las etapas de los últimos frames', () => {
    const { outbox } = fakeOutbox(false);
    const engine = new EdgeEngine(
      { cameraId: 'CEL-04', serverUrl: 'https://vigia.example', token: 't' },
      { name: 'vehicles', digest: 'abc' },
      outbox,
      () => undefined,
    );
    engine.start();
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    for (let index = 0; index < 60; index++) {
      engine.process({
        ...frame({ x1: 0, y1: 0, x2: 100, y2: 100 }, false),
        timings: { prepare: 20, detect: 60, decode: 1, color: index % 2 ? 40 : 0, colorCrops: index % 2, thumbnail: 2, plate: 0, total: 83 + (index % 2 ? 40 : 0), finishedAt: Date.now() },
      });
    }
    const timings = engine.stats.timings;
    expect(timings?.samples).toBe(50);
    expect(timings?.detect).toEqual({ p50: 60, p95: 60 });
    expect(timings?.total.p95).toBe(123);
    expect(timings?.colorCropsPerFrame).toBe(0.5);
    expect(log).toHaveBeenCalledWith('VIGIA-TIEMPOS', expect.any(String));
    log.mockRestore();
    void engine.stop();
  });
});

describe('placas en el motor', () => {
  test('vota la placa por track y ofrece compuertas solo mientras hace falta', () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const { outbox } = fakeOutbox(false);
    const gates: { box: Box }[][] = [];
    const engine = new EdgeEngine(
      { cameraId: 'CEL-05', serverUrl: 'https://vigia.example', token: 't' },
      { name: 'vehicles', digest: 'abc' },
      outbox,
      () => undefined,
      null,
      () => undefined,
      () => undefined,
      (value) => gates.push(value),
    );
    engine.start();
    const tick = (plate: FrameProcessingResult['plate'] = null) => {
      engine.process({ ...frame({ x1: 0, y1: 0, x2: 300, y2: 200 }, false), plate, cameraSize: { width: 1920, height: 1440 } });
      jest.advanceTimersByTime(900);
    };
    const read = (text: string) => ({ detectionIndex: 0, areaPx: 60_000, attempt: { status: 'read' as const, widthPx: 70, text, confidence: 0.9 } });

    tick();
    expect(gates.at(-1)).toEqual([]); // Sin confirmar: ninguna compuerta.
    tick();
    expect(gates.at(-1)).toHaveLength(1);
    tick({ detectionIndex: 0, areaPx: 60_000, attempt: { status: 'small', widthPx: 30 } });
    tick(read('ABC123'));
    expect(engine.stats.overlay?.tracks[0]?.plate).toBeNull();
    tick(read('ABC123'));
    expect(engine.stats.overlay?.tracks[0]?.plate).toBe('ABC123');
    expect(engine.stats.plates).toMatchObject({ enabled: true, attempts: 3, small: 1, reads: 2, voted: 1, widestPx: 70 });

    void engine.stop();
    jest.useRealTimers();
  });

  test('sin modelos de placa no publica compuertas y lo informa', () => {
    const { outbox } = fakeOutbox(false);
    const engine = new EdgeEngine(
      { cameraId: 'CEL-06', serverUrl: 'https://vigia.example', token: 't' },
      { name: 'vehicles', digest: 'abc' },
      outbox,
      () => undefined,
    );
    expect(engine.stats.plates.enabled).toBe(false);
  });
});

describe('sobre con placa', () => {
  test('licensePlate lleva la placa votada del track, o null', () => {
    const track = new Track(7, { box: { x1: 0, y1: 0, x2: 10, y2: 10 }, score: 0.9, label: 'car' }, 0);
    const envelope = () => buildEnvelope({
      cameraId: 'CEL-07', sessionId: 's', sequenceNumber: 1, frameNumber: 1, modelName: 'm', modelDigest: null,
      tracks: [track], generatedAt: 0, eventId: 'e',
    });
    expect(envelope().detections[0]?.licensePlate).toBeNull();
    const read = { status: 'read' as const, widthPx: 60, text: 'XYZ98A', confidence: 0.8 };
    track.plateReads.add(read, 100, 1);
    track.plateReads.add(read, 100, 2);
    expect(envelope().detections[0]?.licensePlate).toBe('XYZ98A');
  });
});
