import { afterEach, describe, expect, jest, test } from '@jest/globals';

import { validateEdgeServerUrl, verifyEdgeToken } from './config';

jest.mock('expo-crypto', () => ({
  getRandomBytes: (length: number) => new Uint8Array(length).fill(3),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock('../storage/secure', () => ({
  secureStorage: {
    readEdgeToken: jest.fn(async () => null),
    writeEdgeToken: jest.fn(async (_token: string) => undefined),
    clearEdgeToken: jest.fn(async () => undefined),
  },
}));

afterEach(() => {
  jest.restoreAllMocks();
});

describe('configuración edge', () => {
  test('permite HTTPS público y HTTP solo para hosts locales', () => {
    expect(validateEdgeServerUrl('https://api.vigia.example')).toBeNull();
    expect(validateEdgeServerUrl('http://192.168.1.20:8000')).toMatch(/HTTPS/);
    expect(validateEdgeServerUrl('http://10.0.2.2:8000')).toBeNull();
    expect(validateEdgeServerUrl('http://api.vigia.example')).toMatch(/HTTPS/);
    expect(validateEdgeServerUrl('https://user:pass@api.vigia.example')).toMatch(/credenciales/);
  });

  test('verifica token publicando un envelope vacío con el contrato edge', async () => {
    const fetcher = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 202 } as Response);
    await expect(verifyEdgeToken({
      cameraId: 'CEL-01',
      serverUrl: 'https://api.vigia.example/',
      token: 'edge-token',
    })).resolves.toBeUndefined();
    const [url, options] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe('https://api.vigia.example/api/v1/ingest/detections');
    expect(options?.method).toBe('POST');
    expect(options?.headers).toMatchObject({ 'X-Vigia-Device-Token': 'edge-token' });
    expect(JSON.parse(String(options?.body))).toMatchObject({
      schemaVersion: '1.1',
      cameraId: 'CEL-01',
      sequenceNumber: 1,
      detections: [],
    });
  });

  test('presenta explícitamente el rechazo de credenciales del servidor', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 401 } as Response);
    await expect(verifyEdgeToken({
      cameraId: 'CEL-01',
      serverUrl: 'https://api.vigia.example',
      token: 'invalid',
    })).rejects.toThrow('rechazó el token');
  });
});
