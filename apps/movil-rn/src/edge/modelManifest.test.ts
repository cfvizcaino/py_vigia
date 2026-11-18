import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from '@jest/globals';

import colorManifest from '../../assets/models/colors.json';
import vehicleManifest from '../../assets/models/vehicles.json';
import plateManifest from '../../assets/models/plates.json';
import plateOcrManifest from '../../assets/models/plate-ocr.json';
import { parseModelManifest } from './modelManifest';

describe('manifiestos y modelos distribuidos', () => {
  test.each([
    ['colors.tflite', colorManifest, 'colors'],
    ['vehicles.tflite', vehicleManifest, 'vehicles'],
    ['plates.tflite', plateManifest, 'plates'],
    ['plate-ocr.tflite', plateOcrManifest, 'ocr'],
  ] as const)('%s existe y coincide con su SHA-256 de manifiesto', (fileName, manifest, task) => {
    const bytes = readFileSync(resolve(__dirname, '../../assets/models', fileName));
    const parsed = parseModelManifest(manifest, task);
    const digest = createHash('sha256').update(bytes).digest('hex');
    expect(digest).toBe(parsed.sha256.toLowerCase());
  });
});

describe('manifiesto de cada tipo de modelo', () => {
  test('no acepta el detector de placas como detector de vehículos', () => {
    expect(() => parseModelManifest(plateManifest, 'vehicles')).toThrow();
    expect(() => parseModelManifest(vehicleManifest, 'plates')).toThrow();
  });

  test('el OCR trae su alfabeto y entrada uint8 NHWC', () => {
    const parsed = parseModelManifest(plateOcrManifest, 'ocr');
    expect(parsed.alphabet).toBe('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_');
    expect(parsed.input).toMatchObject({ dtype: 'uint8', layout: 'NHWC', shape: [1, 64, 128, 3] });
  });
});
