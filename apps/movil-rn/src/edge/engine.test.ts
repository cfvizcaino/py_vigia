import { describe, expect, jest, test } from '@jest/globals';

import { EdgeEngine } from './engine';
import type { Outbox, ThumbnailItem } from './outbox';
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
