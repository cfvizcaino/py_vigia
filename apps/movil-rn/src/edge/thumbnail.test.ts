import { describe, expect, test } from '@jest/globals';

import { prepareThumbnail } from './preprocess';
import type { FrameData } from './types';

function rgbFrame(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): FrameData {
  const bytes = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) bytes.set(pixel(x, y), (y * width + x) * 3);
  }
  return { format: 'rgb888', width, height, planes: [{ bytes, bytesPerRow: width * 3, bytesPerPixel: 3 }] };
}

describe('recorte para confirmación manual', () => {
  test('caja + 10 %, lado mayor ≤ 224 y promedio por bloques', () => {
    const frame = rgbFrame(640, 480, (x) => (x < 320 ? [0, 0, 0] : [200, 100, 50]));
    const crop = prepareThumbnail(frame, { x1: 100, y1: 100, x2: 500, y2: 300 });
    // 400 × 200 más 10 % por lado = 480 × 240 → paso 3 → 160 × 80.
    expect([crop.width, crop.height]).toEqual([160, 80]);
    expect(crop.rgb).toHaveLength(160 * 80 * 3);
    expect(Array.from(crop.rgb.slice(0, 3))).toEqual([0, 0, 0]);
    expect(Array.from(crop.rgb.slice(-3))).toEqual([200, 100, 50]);
  });

  test('endereza el frame según la rotación del sensor', () => {
    // Sensor apaisado 8 × 4 girado 90°: la imagen derecha mide 4 × 8.
    const frame = { ...rgbFrame(8, 4, (x) => (x === 0 ? [255, 0, 0] : [0, 0, 255])), rotationDegrees: 90 as const };
    const crop = prepareThumbnail(frame, { x1: 0, y1: 0, x2: 4, y2: 8 }, 224, 0);
    expect([crop.width, crop.height]).toEqual([4, 8]);
    // La columna x = 0 del sensor queda arriba en la imagen derecha.
    expect(Array.from(crop.rgb.slice(0, 3))).toEqual([255, 0, 0]);
    expect(Array.from(crop.rgb.slice(-3))).toEqual([0, 0, 255]);
  });
});
