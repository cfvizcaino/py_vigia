import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { migrateFlutterData } from './flutterMigration';
import type { FlutterData, FlutterDataSource } from './flutterMigration';

const mockAsyncValues = new Map<string, string>();
const mockSecureValues = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockAsyncValues.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => void mockAsyncValues.set(key, value)),
    removeItem: jest.fn(async (key: string) => void mockAsyncValues.delete(key)),
  },
}));

jest.mock('./secure', () => ({
  secureStorage: {
    readSessionToken: jest.fn(async () => mockSecureValues.get('session') ?? null),
    writeSessionToken: jest.fn(async (token: string) => void mockSecureValues.set('session', token)),
    readEdgeToken: jest.fn(async () => mockSecureValues.get('edge') ?? null),
    writeEdgeToken: jest.fn(async (token: string) => void mockSecureValues.set('edge', token)),
    clearEdgeToken: jest.fn(async () => void mockSecureValues.delete('edge')),
  },
}));

jest.mock('expo-crypto', () => ({ getRandomBytes: (length: number) => new Uint8Array(length).fill(3) }));

function source(data: FlutterData): FlutterDataSource & { clearFlutterData: jest.Mock } {
  return {
    readFlutterData: jest.fn(async () => data),
    clearFlutterData: jest.fn(async () => undefined),
  } as FlutterDataSource & { clearFlutterData: jest.Mock };
}

beforeEach(() => {
  mockAsyncValues.clear();
  mockSecureValues.clear();
});

describe('migración desde la app Flutter', () => {
  test('copia URL, sesión y edge, y borra la copia de Flutter una sola vez', async () => {
    const flutter = source({
      vigia_api_base_url: 'https://vigia.example',
      vigia_session_token: 'session-token',
      vigia_edge_camera: 'CEL-02',
      vigia_edge_server: 'https://vigia.example',
      vigia_edge_token: 'edge-token',
    });
    await migrateFlutterData(flutter);

    expect(mockAsyncValues.get('vigia_api_base_url')).toBe('https://vigia.example');
    expect(JSON.parse(mockAsyncValues.get('vigia_edge_configuration') ?? '{}')).toEqual({
      cameraId: 'CEL-02',
      serverUrl: 'https://vigia.example',
    });
    expect(mockSecureValues.get('session')).toBe('session-token');
    expect(mockSecureValues.get('edge')).toBe('edge-token');
    expect(flutter.clearFlutterData).toHaveBeenCalledTimes(1);

    await migrateFlutterData(flutter);
    expect(flutter.readFlutterData).toHaveBeenCalledTimes(1);
  });

  test('no pisa lo que ya guardó la app nueva', async () => {
    mockAsyncValues.set('vigia_api_base_url', 'https://nuevo.example');
    mockSecureValues.set('session', 'nuevo');
    await migrateFlutterData(source({ vigia_api_base_url: 'https://viejo.example', vigia_session_token: 'viejo' }));
    expect(mockAsyncValues.get('vigia_api_base_url')).toBe('https://nuevo.example');
    expect(mockSecureValues.get('session')).toBe('nuevo');
  });

  test('si falla, no borra nada y lo reintenta en el próximo inicio', async () => {
    const flutter = source({ vigia_session_token: 'session-token' });
    const { secureStorage } = jest.requireMock<{ secureStorage: { writeSessionToken: jest.Mock } }>('./secure');
    secureStorage.writeSessionToken.mockImplementationOnce(async () => {
      throw new Error('Keystore no disponible');
    });
    await expect(migrateFlutterData(flutter)).rejects.toThrow('Keystore');
    expect(flutter.clearFlutterData).not.toHaveBeenCalled();
    await migrateFlutterData(flutter);
    expect(mockSecureValues.get('session')).toBe('session-token');
    expect(flutter.clearFlutterData).toHaveBeenCalledTimes(1);
  });
});
