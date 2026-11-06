import { describe, expect, jest, test } from '@jest/globals';

import { pickColorDetections, pickThumbnail } from './FrameProcessor';
import type { Detection, FrameData } from '../edge/types';

// babel-jest hoists these mocks above the imports.

jest.mock('react-native-vision-camera', () => ({ useFrameOutput: jest.fn() }));
jest.mock('react-native-worklets', () => ({ scheduleOnRN: jest.fn() }));
jest.mock('react-native-nitro-modules', () => ({ NitroModules: { box: jest.fn() } }));
jest.mock('react-native-reanimated', () => ({ useSharedValue: jest.fn() }));

const car = (x1: number, y1: number, size = 60, score = 0.9): Detection => ({
  box: { x1, y1, x2: x1 + size, y2: y1 + size },
  score,
  label: 'car',
});

describe('pickColorDetections', () => {
  test('sigue el orden de las compuertas, como máximo tres, sin repetir ni recortes pequeños', () => {
    const detections = [car(0, 0), car(200, 0), car(400, 0), car(600, 0), car(800, 0, 10)];
    const gates = [600, 0, 800, 200, 400].map((x) => ({ box: { x1: x + 2, y1: 0, x2: x + 62, y2: 60 } }));
    expect(pickColorDetections(detections, gates)).toEqual([3, 0, 1]);
  });

  test('sin compuertas no clasifica nada', () => {
    expect(pickColorDetections([car(0, 0)], [])).toEqual([]);
  });
});

describe('pickThumbnail', () => {
  const frame: FrameData = {
    format: 'rgb888',
    width: 1000,
    height: 200,
    planes: [{ bytes: new Uint8Array(1000 * 200 * 3), bytesPerRow: 3000, bytesPerPixel: 3 }],
  };

  test('solo recorta detecciones de tracks confirmados (con compuerta)', () => {
    const detections = [car(0, 0, 100), car(400, 0, 60)];
    const gates = [{ box: { x1: 402, y1: 0, x2: 462, y2: 60 }, minArea: 0 }];
    expect(pickThumbnail(frame, detections, gates)?.detectionIndex).toBe(1);
  });

  test('no repite un track cuya vista no creció lo suficiente', () => {
    const detections = [car(400, 0, 60)];
    const gates = [{ box: { x1: 400, y1: 0, x2: 460, y2: 60 }, minArea: 60 * 60 * 1.2 }];
    expect(pickThumbnail(frame, detections, gates)).toBeNull();
  });
});
