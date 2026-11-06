import { describe, expect, test } from '@jest/globals';

import { decodeBestPlate, decodePlateText, plateDetectorMinScore, PlateReads, validPlate } from './plates';
import { preparePlate, prepareRegion } from './preprocess';
import type { FrameData } from './types';

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_';

function ocrOutput(text: string, confidence = 0.9): Float32Array {
  const out = new Float32Array(10 * alphabet.length);
  for (let slot = 0; slot < 10; slot++) {
    const char = text[slot] ?? '_';
    out[slot * alphabet.length + alphabet.indexOf(char)] = confidence;
  }
  return out;
}

const read = (text: string, confidence = 0.9) => ({ status: 'read' as const, widthPx: 60, text, confidence });

describe('formato de placa colombiana', () => {
  test.each(['ABC123', 'ABC12', 'ABC12D'])('acepta %s', (plate) => expect(validPlate(plate)).toBe(true));
  test.each(['AB123', 'ABC1234', '123ABC', 'ABC1D2', ''])('rechaza %s', (plate) => expect(validPlate(plate)).toBe(false));
});

describe('voto de placa por track', () => {
  test('reporta un texto solo cuando se repite y no empata', () => {
    const reads = new PlateReads();
    reads.add(read('ABC123'), 100, 0);
    expect(reads.plate).toBeNull();
    reads.add(read('ABC128'), 100, 1);
    reads.add(read('ABC123'), 100, 2);
    expect(reads.plate).toBe('ABC123');
    reads.add(read('ABC128'), 100, 3);
    expect(reads.plate).toBeNull(); // 2 contra 2.
  });

  test('descarta lecturas dudosas o sin formato, pero las cuenta como intento', () => {
    const reads = new PlateReads();
    reads.add(read('ABC123', 0.3), 100, 0);
    reads.add(read('ABC123', 0.3), 100, 1);
    reads.add(read('HELLO1'), 100, 2);
    reads.add(read('HELLO1'), 100, 3);
    expect(reads.plate).toBeNull();
    expect(reads.reads).toBe(4);
  });

  test('deja de leer tras seis lecturas y no cuenta placas pequeñas como lectura', () => {
    const reads = new PlateReads();
    reads.add({ status: 'small', widthPx: 30 }, 100, 0);
    reads.add({ status: 'none' }, 100, 1);
    expect(reads.reads).toBe(0);
    expect(reads.attempts).toBe(2);
    for (let i = 0; i < 6; i++) reads.add(read('XYZ987'), 100, i);
    expect(reads.wantsRead()).toBe(false);
    expect(reads.plate).toBe('XYZ987');
  });
});

describe('decodificación', () => {
  test('texto del OCR sin relleno y confianza del carácter más dudoso', () => {
    const out = ocrOutput('ABC123');
    out[2 * alphabet.length + alphabet.indexOf('C')] = 0.6;
    expect(decodePlateText(out, alphabet, 10, '_')).toEqual({ text: 'ABC123', confidence: expect.closeTo(0.6, 5) });
    expect(decodePlateText(ocrOutput(''), alphabet, 10, '_')).toEqual({ text: '', confidence: 0 });
  });

  test('mejor placa del detector, de vuelta a píxeles de la región', () => {
    const letterbox = { size: 320, scale: 0.5, padX: 0, padY: 40, uprightWidth: 640, uprightHeight: 480 };
    const output = new Float32Array(300 * 6);
    output.set([100, 140, 140, 160, 0.5, 0], 0); // Débil.
    output.set([200, 240, 260, 260, 0.9, 0], 6);
    output.set([10, 10, 20, 20, 0.3, 0], 12); // Bajo el umbral.
    expect(decodeBestPlate(output, letterbox, plateDetectorMinScore)).toEqual({ x1: 400, y1: 400, x2: 520, y2: 440, score: expect.closeTo(0.9, 5) });
    expect(decodeBestPlate(new Float32Array(300 * 6), letterbox, plateDetectorMinScore)).toBeNull();
  });
});

function gradientFrame(width: number, height: number): FrameData {
  const bytes = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      bytes.set([x, y, 7], (y * width + x) * 3);
    }
  }
  return { format: 'rgb888', width, height, planes: [{ bytes, bytesPerRow: width * 3, bytesPerPixel: 3 }] };
}

describe('preparación de placa y región', () => {
  test('la placa se redimensiona bilinealmente a 128×64 RGB uint8', () => {
    const frame = gradientFrame(200, 100);
    // 64×32 px → 128×64: cada píxel de salida cae entre dos del frame.
    const plate = preparePlate(frame, { x1: 10, y1: 20, x2: 74, y2: 52 }, 128, 64);
    expect(plate).toHaveLength(128 * 64 * 3);
    expect(Array.from(plate.slice(0, 3))).toEqual([10, 20, 7]);
    const last = (64 * 128 - 1) * 3;
    expect(Array.from(plate.slice(last, last + 3))).toEqual([73, 51, 7]);
    // Entre x=41 y x=42 (columna 63 → fx = 63,5 × 0,5 − 0,5 = 31,25).
    expect(plate[63 * 3]).toBe(Math.round(10 + 31.25));
  });

  test('la región se letterboxea sola y el letterbox vuelve a sus píxeles', () => {
    const frame = gradientFrame(200, 100);
    const { pixels, letterbox } = prepareRegion(frame, { left: 50, top: 30, width: 40, height: 20 }, 8, true);
    expect(letterbox).toMatchObject({ uprightWidth: 40, uprightHeight: 20, scale: 0.2, padX: 0, padY: 2 });
    // Primer píxel con contenido: fila 2, columna 0 → (50 + 2, 30 + 2) del frame.
    expect(Math.round((pixels[2 * 8] ?? 0) * 255)).toBe(52);
    expect(Math.round((pixels[64 + 2 * 8] ?? 0) * 255)).toBe(32);
  });
});
