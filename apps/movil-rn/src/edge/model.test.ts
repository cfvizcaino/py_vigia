import { describe, expect, jest, test } from '@jest/globals';

import { loadModel } from './model';

const mockDigest = 'ab'.repeat(32);
const mockLoad = jest.fn(async (_source: unknown, _delegates: unknown) => ({
  inputs: [{ dataType: 'float32', shape: [1, 3, 320, 320] }],
  outputs: [{ dataType: 'float32', shape: [1, 300, 6] }],
}));

jest.mock('../../assets/models/vehicles.tflite', () => 1);
jest.mock('../../assets/models/colors.tflite', () => 2);
jest.mock('react-native-fast-tflite', () => ({
  loadTensorflowModel: (source: unknown, delegates: unknown) => mockLoad(source, delegates),
}));
jest.mock('expo-asset', () => ({
  Asset: {
    fromModule: () => ({ localUri: 'file:///data/user/0/co.vigia.movil/cache/vehicles.tflite', downloadAsync: async () => undefined }),
  },
}));
jest.mock('expo-file-system', () => ({
  File: class {
    async bytes() {
      return new Uint8Array([1, 2, 3]);
    }
  },
}));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: async () => new Uint8Array(32).fill(0xab).buffer,
}));
jest.mock('./modelManifest', () => ({
  parseModelManifest: () => ({
    sha256: mockDigest,
    input: { dtype: 'float32', shape: [1, 3, 320, 320] },
    output: { dtype: 'float32', shape: [1, 300, 6] },
  }),
}));

describe('carga del modelo TFLite', () => {
  test('carga el mismo archivo local cuya huella verificó (no el id del módulo)', async () => {
    await loadModel({ assetId: 42, manifestData: {}, expectedTask: 'detect' });
    expect(mockLoad).toHaveBeenCalledWith({ url: 'file:///data/user/0/co.vigia.movil/cache/vehicles.tflite' }, []);
  });
});
