import { describe, expect, it } from '@jest/globals';

import { prepareInput } from '../edge/preprocess';
import type { FrameData } from '../edge/types';
import { rotationForOrientation } from './orientation';

/** Landscape RGB frame (as the sensor delivers it) with one red pixel. */
function frameWithRedPixel(width: number, height: number, x: number, y: number, rotationDegrees: 0 | 90 | 180 | 270): FrameData {
  const bytes = new Uint8Array(width * height * 3);
  bytes[(y * width + x) * 3] = 255;
  return { format: 'rgb888', width, height, rotationDegrees, planes: [{ bytes, bytesPerRow: width * 3, bytesPerPixel: 3 }] };
}

describe('rotationForOrientation', () => {
  it('endereza según cómo VisionCamera dice que vienen girados los píxeles', () => {
    expect(rotationForOrientation('up')).toBe(0);
    expect(rotationForOrientation('right')).toBe(270);
    expect(rotationForOrientation('down')).toBe(180);
    expect(rotationForOrientation('left')).toBe(90);
  });

  it('suma la rotación adicional del operador', () => {
    expect(rotationForOrientation('right', 90)).toBe(0);
    expect(rotationForOrientation('left', 270)).toBe(0);
    expect(rotationForOrientation('up', 180)).toBe(180);
  });

  it("con 'right' la parte de arriba de la escena queda arriba en la entrada del modelo", () => {
    // Content turned 90° clockwise: the scene's top edge is the buffer's right edge.
    // A pixel at the right edge, vertically centred, is the top centre of the scene.
    const frame = frameWithRedPixel(4, 2, 3, 1, rotationForOrientation('right'));
    const input = prepareInput(frame, 4);
    const red = Array.from({ length: 16 }, (_, index) => input.pixels[index * 3] ?? 0);
    const hot = red.findIndex((value) => value > 0.9);
    expect(Math.floor(hot / 4)).toBe(0); // first row of the model input
  });
});
