import { describe, expect, test } from '@jest/globals';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import schema from '../../../../packages/contracts/detection-envelope-1.1.schema.json';

import { ColorVotes } from './colors';
<<<<<<< HEAD
import { decodeYolo, nonMaxSuppression } from './detections';
import { buildEnvelope, uuidV4 } from './envelope';
import { prepareCrop, prepareInput, uprightToSensor } from './preprocess';
=======
import { decodeYolo } from './detections';
import { buildEnvelope, uuidV4 } from './envelope';
import { prepareInput, uprightToSensor } from './preprocess';
>>>>>>> df0453cade982a2911157addaf8931f9efe04285
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
<<<<<<< HEAD
  test('convierte YUV420 gris y rojo a RGB', () => {
    const gray: FrameData = {
      format: 'yuv420',
      width: 2,
      height: 2,
      planes: [
        { bytes: new Uint8Array([128, 128, 128, 128]), bytesPerRow: 2 },
        { bytes: new Uint8Array([128]), bytesPerRow: 1 },
        { bytes: new Uint8Array([128]), bytesPerRow: 1 },
      ],
    };
    const grayRgb = prepareInput(gray, 1).pixels;
    expect(grayRgb[0]).toBeCloseTo(128 / 255);
    expect(grayRgb[1]).toBeCloseTo(128 / 255);
    expect(grayRgb[2]).toBeCloseTo(128 / 255);

    const red: FrameData = {
      format: 'yuv420',
      width: 1,
      height: 1,
      planes: [
        { bytes: new Uint8Array([76]), bytesPerRow: 1 },
        { bytes: new Uint8Array([85]), bytesPerRow: 1 },
        { bytes: new Uint8Array([255]), bytesPerRow: 1 },
      ],
    };
    const redRgb = prepareInput(red, 1).pixels;
    expect(redRgb[0]).toBeGreaterThan(0.95);
    expect(redRgb[1]).toBeLessThan(0.02);
    expect(redRgb[2]).toBeLessThan(0.02);
  });

=======
>>>>>>> df0453cade982a2911157addaf8931f9efe04285
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
<<<<<<< HEAD
    const nhwc = prepareInput(frame, 1, false);
    expect(Array.from(nhwc.pixels)).toEqual(Array.from(input.pixels));
=======
>>>>>>> df0453cade982a2911157addaf8931f9efe04285
  });

  test('mapea coordenadas para rotación de 90 grados', () => {
    expect(uprightToSensor(1, 0, 3, 2, 90)).toEqual([0, 0]);
  });

<<<<<<< HEAD
  test('reduce la imagen, deja padding gris 114 y rota los píxeles', () => {
    const frame: FrameData = {
      format: 'rgb888',
      width: 4,
      height: 2,
      planes: [{
        bytes: new Uint8Array([
          255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255,
          255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255,
        ]),
        bytesPerRow: 12,
        bytesPerPixel: 3,
      }],
    };
    const reduced = prepareInput(frame, 2);
    expect(reduced.letterbox).toMatchObject({ scale: 0.5, uprightWidth: 4, uprightHeight: 2 });
    expect(reduced.pixels[0]).toBeCloseTo(0);
    expect(reduced.pixels[1]).toBeCloseTo(1);
    expect(reduced.pixels[6]).toBeCloseTo(114 / 255);
    expect(reduced.pixels[7]).toBeCloseTo(114 / 255);
    expect(reduced.pixels[8]).toBeCloseTo(114 / 255);

    const rotated = prepareInput({ ...frame, rotationDegrees: 90 }, 2);
    expect(rotated.letterbox).toMatchObject({ uprightWidth: 2, uprightHeight: 4, scale: 0.5 });
    expect(rotated.pixels).toHaveLength(12);
  });

  test('recorta el centro del vehículo y respeta la rotación', () => {
    const frame: FrameData = {
      format: 'rgb888',
      width: 4,
      height: 2,
      planes: [{
        bytes: new Uint8Array([
          255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255,
          255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255,
        ]),
        bytesPerRow: 12,
        bytesPerPixel: 3,
      }],
    };
    const center = prepareCrop(frame, { x1: 0, y1: 0, x2: 4, y2: 2 }, 2);
    expect(Array.from(center.slice(0, 3))).toEqual([0, 1, 0]);
    expect(Array.from(center.slice(3, 6))).toEqual([0, 0, 1]);

    const rotated = prepareCrop({ ...frame, rotationDegrees: 90 }, { x1: 0, y1: 0, x2: 2, y2: 4 }, 2);
    expect(rotated).toHaveLength(12);
    expect(Array.from(rotated.slice(0, 3))).toEqual([0, 1, 0]);
  });

=======
>>>>>>> df0453cade982a2911157addaf8931f9efe04285
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

<<<<<<< HEAD
  test('rechaza formas desconocidas y NMS conserva etiquetas distintas', () => {
    expect(() => decodeYolo(new Float32Array(10), [1, 4, 10], letterbox)).toThrow(/no soportada/);
    expect(() => decodeYolo(new Float32Array(10), [2, 10, 1], letterbox)).toThrow(/no soportada/);
    const detections: Detection[] = [
      { box: { x1: 1, y1: 1, x2: 20, y2: 20 }, score: 0.9, label: 'car' },
      { box: { x1: 2, y1: 2, x2: 21, y2: 21 }, score: 0.8, label: 'car' },
      { box: { x1: 2, y1: 2, x2: 21, y2: 21 }, score: 0.7, label: 'motorcycle' },
    ];
    expect(nonMaxSuppression(detections)).toHaveLength(2);
    expect(nonMaxSuppression(detections).map(({ label }) => label)).toEqual(['car', 'motorcycle']);
  });

  test('despublica un parpadeo y recupera un vehículo con predicción sin mezclar etiquetas', () => {
    const tracker = new IouTracker(0.35, 0.35, 0.2, 2, 1_000);
    const detection = (x1: number, label: Detection['label'] = 'car', score = 0.8): Detection => ({
      box: { x1, y1: 30, x2: x1 + 20, y2: 50 },
      score,
      label,
    });
    tracker.update([detection(10)], 1000);
    expect(tracker.active(1000)).toHaveLength(0);
    tracker.update([], 1100);
    expect(tracker.active(1100)).toHaveLength(0);

    tracker.update([detection(10)], 2000);
    const tracked = tracker.update([detection(20)], 3000)[0];
    expect(tracked?.hits).toBe(2);
    const sameTrack = tracker.update([detection(20, 'car', 0.2)], 3100)[0];
    expect(sameTrack?.id).toBe(tracked?.id);
    expect(sameTrack?.hits).toBe(3);
    tracker.update([], 3200);
    const recovered = tracker.update([detection(24)], 4000)[0];
    expect(recovered?.id).toBe(tracked?.id);
    expect(recovered?.label).toBe('car');

    tracker.update([], 5001);
    const newLabel = tracker.update([detection(40, 'motorcycle')], 5002)[0];
    expect(newLabel?.id).not.toBe(recovered?.id);
    expect(newLabel?.label).toBe('motorcycle');
  });

  test('mantiene dirección indeterminada sin desplazamiento y exige votos espaciados de color', () => {
    const tracker = new IouTracker();
    const still = {
      box: { x1: 30, y1: 40, x2: 100, y2: 110 },
      score: 0.8,
      label: 'car' as const,
    };
    tracker.update([still], 1000);
    const track = tracker.update([{ ...still, box: { ...still.box } }], 1100)[0];
    expect(track?.direction).toBe('indeterminada');

    const votes = new ColorVotes();
    expect(votes.wantsSample(0)).toBe(true);
    votes.add({ red: 0.8, blue: 0.2 }, 0);
    expect(votes.color).toBeNull();
    expect(votes.wantsSample(499)).toBe(false);
    expect(votes.wantsSample(500)).toBe(true);
    votes.add({ red: 0.7, blue: 0.3 }, 500);
    expect(votes.color).toBe('red');
  });

=======
>>>>>>> df0453cade982a2911157addaf8931f9efe04285
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
