import { describe, expect, it } from '@jest/globals';

import { prepareCrop, prepareInput, prepareThumbnail, uprightToSensor } from './preprocess';
import type { FrameData } from './types';

type PackedFormat = 'rgb888' | 'rgba8888' | 'bgra8888';
const rotations = [0, 90, 180, 270] as const;
const formats: PackedFormat[] = ['rgb888', 'rgba8888', 'bgra8888'];

/** Random frame with row padding, so bytesPerRow ≠ width × bytesPerPixel. */
function randomFrame(format: PackedFormat, width: number, height: number, rotationDegrees: 0 | 90 | 180 | 270): FrameData {
  const bytesPerPixel = format === 'rgb888' ? 3 : 4;
  const bytesPerRow = width * bytesPerPixel + 5;
  const bytes = new Uint8Array(bytesPerRow * height);
  let seed = width * 31 + height * 17 + rotationDegrees;
  for (let i = 0; i < bytes.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    bytes[i] = seed & 0xff;
  }
  return { format, width, height, rotationDegrees, planes: [{ bytes, bytesPerRow, bytesPerPixel }] };
}

/** The upright pixel as the original per-pixel code read it. */
function referenceRgb(frame: FrameData, ux: number, uy: number): [number, number, number] {
  const [sx, sy] = uprightToSensor(ux, uy, frame.width, frame.height, frame.rotationDegrees ?? 0);
  const plane = frame.planes[0]!;
  const offset = sy * plane.bytesPerRow + sx * plane.bytesPerPixel!;
  const r = plane.bytes[offset]!;
  const g = plane.bytes[offset + 1]!;
  const b = plane.bytes[offset + 2]!;
  return frame.format === 'bgra8888' ? [b, g, r] : [r, g, b];
}

describe('fast packed-RGB preprocessing', () => {
  for (const format of formats) {
    for (const rotation of rotations) {
      it(`matches the per-pixel reference (${format}, ${rotation}°)`, () => {
        const frame = randomFrame(format, 23, 17, rotation);
        const turned = rotation === 90 || rotation === 270;
        const uprightWidth = turned ? 17 : 23;
        const uprightHeight = turned ? 23 : 17;

        const size = 16;
        const { pixels, letterbox } = prepareInput(frame, size, true);
        const contentWidth = Math.round(uprightWidth * letterbox.scale);
        const contentHeight = Math.round(uprightHeight * letterbox.scale);
        const plane = size * size;
        for (let oy = 0; oy < contentHeight; oy++) {
          for (let ox = 0; ox < contentWidth; ox++) {
            const ux = Math.min(Math.floor((ox + 0.5) / letterbox.scale), uprightWidth - 1);
            const uy = Math.min(Math.floor((oy + 0.5) / letterbox.scale), uprightHeight - 1);
            const [r, g, b] = referenceRgb(frame, ux, uy);
            const index = (letterbox.padY + oy) * size + letterbox.padX + ox;
            expect(pixels[index]).toBeCloseTo(r / 255, 6);
            expect(pixels[index + plane]).toBeCloseTo(g / 255, 6);
            expect(pixels[index + plane * 2]).toBeCloseTo(b / 255, 6);
          }
        }

        const box = { x1: 3, y1: 2, x2: 13, y2: 15 };
        const crop = prepareCrop(frame, box, 8, false);
        const side = 10;
        const left = Math.round(3 + (10 - side) / 2);
        const top = Math.round(2 + (13 - side) / 2);
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const [r, g, b] = referenceRgb(
              frame,
              left + Math.min(side - 1, Math.floor((x + 0.5) * side / 8)),
              top + Math.min(side - 1, Math.floor((y + 0.5) * side / 8)),
            );
            const index = (y * 8 + x) * 3;
            expect([crop[index], crop[index + 1], crop[index + 2]].map((v) => Math.round(v! * 255))).toEqual([r, g, b]);
          }
        }

        const thumbnail = prepareThumbnail(frame, { x1: 1, y1: 1, x2: 15, y2: 15 }, 4, 0);
        expect(thumbnail.width).toBe(3);
        const [r, g, b] = [0, 1, 2].map((channel) => {
          let sum = 0;
          // Bloques de 4 px: 2×2 muestras (0 y 2).
          for (const dy of [0, 2]) for (const dx of [0, 2]) sum += referenceRgb(frame, 1 + dx, 1 + dy)[channel]!;
          return Math.round(sum / 4);
        });
        expect(Array.from(thumbnail.rgb.slice(0, 3))).toEqual([r, g, b]);
      });
    }
  }
});
