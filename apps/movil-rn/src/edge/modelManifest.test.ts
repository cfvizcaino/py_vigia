import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from '@jest/globals';

import colorManifest from '../../assets/models/colors.json';
import vehicleManifest from '../../assets/models/vehicles.json';
import { parseModelManifest } from './modelManifest';

describe('manifiestos y modelos distribuidos', () => {
  test.each([
    ['colors.tflite', colorManifest, 'classify'],
    ['vehicles.tflite', vehicleManifest, 'detect'],
  ] as const)('%s existe y coincide con su SHA-256 de manifiesto', (fileName, manifest, task) => {
    const bytes = readFileSync(resolve(__dirname, '../../assets/models', fileName));
    const parsed = parseModelManifest(manifest, task);
    const digest = createHash('sha256').update(bytes).digest('hex');
    expect(digest).toBe(parsed.sha256.toLowerCase());
  });
});
