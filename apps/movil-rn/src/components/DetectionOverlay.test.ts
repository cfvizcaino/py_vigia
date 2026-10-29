import { describe, expect, test } from '@jest/globals';

import { previewAspectRatio, toPreview } from './DetectionOverlay';

describe('cajas sobre la vista previa', () => {
  test('sin rotación extra son fracciones directas del frame', () => {
    expect(toPreview({ x1: 48, y1: 64, x2: 240, y2: 320 }, 480, 640, 0)).toEqual({ x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5 });
    expect(previewAspectRatio(480, 640, 0)).toBe(0.75);
  });

  test('deshace una rotación extra de 90° (el frame quedó apaisado)', () => {
    // Vista previa vertical 480 × 640; girada 90° a la derecha da un frame 640 × 480.
    // La esquina superior izquierda de la vista previa queda arriba a la derecha del frame.
    const box = toPreview({ x1: 576, y1: 0, x2: 640, y2: 48 }, 640, 480, 90);
    expect(box).toEqual({ x1: 0, y1: 0, x2: 0.1, y2: 0.1 });
    expect(previewAspectRatio(640, 480, 90)).toBe(0.75);
  });

  test('deshace 180° y 270°', () => {
    expect(toPreview({ x1: 432, y1: 576, x2: 480, y2: 640 }, 480, 640, 180)).toEqual({ x1: 0, y1: 0, x2: 0.1, y2: 0.1 });
    expect(toPreview({ x1: 0, y1: 432, x2: 64, y2: 480 }, 640, 480, 270)).toEqual({ x1: 0, y1: 0, x2: 0.1, y2: 0.1 });
  });
});
