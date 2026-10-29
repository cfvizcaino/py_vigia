import { describe, expect, test } from '@jest/globals';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import schema from '../../../../packages/contracts/detection-envelope-1.1.schema.json';

import { ColorVotes } from './colors';
import { decodeYolo } from './detections';
import { buildEnvelope, uuidV4 } from './envelope';
import { prepareInput, uprightToSensor } from './preprocess';
import { IouTracker } from './tracker';
import type { Detection, FrameData, Letterbox } from './types';

const letterbox: Letterbox = {
  size: 320,
  scale: 1,
  padX: 0,
  padY: 0,
  uprightWidth: 320,
  uprightHeight: 320,
};

describe('procesamiento Edge', () => {
  test('convierte BGRA en RGB float32 NCHW para el modelo', () => {
    const frame: FrameData = {
      format: 'bgra8888',
      width: 1,
      height: 1,
      planes: [{ bytes: new Uint8Array([30, 20, 10, 255]), bytesPerRow: 4, bytesPerPixel: 4 }],
    };
    const input = prepareInput(frame, 1, true);
    expect(input.pixels[0]).toBeCloseTo(10 / 255);
    expect(input.pixels[1]).toBeCloseTo(20 / 255);
    expect(input.pixels[2]).toBeCloseTo(30 / 255);
  });

  test('mapea coordenadas para rotación de 90 grados', () => {
    expect(uprightToSensor(1, 0, 3, 2, 90)).toEqual([0, 0]);
  });

  test('decodifica YOLO26 [1,300,6] y YOLO clásico NCHW', () => {
    const packed = new Float32Array(300 * 6);
    packed.set([40, 50, 180, 210, 0.91, 2]);
    const packedDetections = decodeYolo(packed, [1, 300, 6], letterbox);
    expect(packedDetections).toHaveLength(1);
    expect(packedDetections[0]).toMatchObject({
      box: { x1: 40, y1: 50, x2: 180, y2: 210 },
      label: 'car',
    });
    expect(packedDetections[0]?.score).toBeCloseTo(0.91);

    const anchors = 1;
    const classic = new Float32Array(6 * anchors);
    classic.set([160, 160, 100, 80, 0.82, 0.1]);
    const classicDetections = decodeYolo(classic, [1, 6, anchors], letterbox, { 0: 'motorcycle' });
    expect(classicDetections).toHaveLength(1);
    expect(classicDetections[0]).toMatchObject({
      box: { x1: 110, y1: 120, x2: 210, y2: 200 },
      label: 'motorcycle',
    });
    expect(classicDetections[0]?.score).toBeCloseTo(0.82);
  });

  test('crea tracks después de dos observaciones y vota el color con fallo seguro', () => {
    const tracker = new IouTracker();
    const detection = (): Detection => ({
      box: { x1: 30, y1: 40, x2: 100, y2: 110 },
      score: 0.8,
      label: 'car',
    });
    const first = tracker.update([detection()], 1000)[0];
    expect(first?.hits).toBe(1);
    expect(tracker.active(1000)).toHaveLength(0);
    const second = tracker.update([detection()], 1100)[0];
    expect(second?.hits).toBe(2);
    expect(tracker.active(1100)).toHaveLength(1);

    second?.colorVotes.add({ red: 0.8, blue: 0.2 }, 1100);
    second?.colorVotes.add({ red: 0.7, blue: 0.3 }, 1600);
    expect(second?.colorVotes.color).toBe('red');
    expect(new ColorVotes().color).toBeNull();
  });

  test('produce Detection Envelope 1.1 compatible con el JSON Schema', () => {
    const idBytes = new Uint8Array(16).fill(9);
    const tracker = new IouTracker();
    tracker.update([{
      box: { x1: 10, y1: 20, x2: 80, y2: 90 },
      score: 0.75,
      label: 'motorcycle',
    }], 1000);
    const tracks = tracker.update([{
      box: { x1: 12, y1: 20, x2: 82, y2: 90 },
      score: 0.83,
      label: 'motorcycle',
    }], 1200);
    const envelope = buildEnvelope({
      cameraId: 'CEL-01',
      sessionId: uuidV4(idBytes),
      sequenceNumber: 1,
      frameNumber: 25,
      modelName: 'vehicles',
      modelDigest: 'a'.repeat(64),
      tracks: tracker.active(1200),
      generatedAt: 1200,
      eventId: uuidV4(new Uint8Array(16).fill(10)),
    });
    expect(tracks[0]?.hits).toBe(2);
    const ajv = new Ajv2020();
    addFormats(ajv);
    expect(ajv.compile(schema)(envelope)).toBe(true);
  });
});
