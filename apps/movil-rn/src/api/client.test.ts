import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { ApiError, VigiaApiClient, validateBackendUrl } from './client';
import type { TokenStore } from './client';

function createTokenStore(token: string | null = 'session-token'): jest.Mocked<TokenStore> {
  return {
    read: jest.fn(async () => token),
    write: jest.fn(async () => undefined),
    clear: jest.fn(async () => undefined),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('VigiaApiClient', () => {
  it('envía Bearer token y normaliza la lista de dispositivos', async () => {
    const tokenStore = createTokenStore();
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        items: [{
          id: 'device-1', external_id: 'CAM-01', name: 'Cámara', kind: 'physical',
          status: 'online', lat: 11, lng: -74,
        }],
      }), { status: 200 }),
    );
    const client = new VigiaApiClient('https://api.example.org/', undefined, tokenStore);

    await expect(client.getDevices()).resolves.toEqual([{
      id: 'device-1', external_id: 'CAM-01', name: 'Cámara', kind: 'physical',
      status: 'online', lat: 11, lng: -74, camera_model: null,
    }]);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.org/api/v1/devices',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer session-token' }) }),
    );
  });

  it('limpia token y notifica al recibir 401 autenticado', async () => {
    const tokenStore = createTokenStore();
    const onUnauthorized = jest.fn((): void => undefined);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
    const client = new VigiaApiClient('https://api.example.org', onUnauthorized, tokenStore);

    await expect(client.currentUser()).rejects.toMatchObject({
      message: 'La sesión venció. Inicia sesión nuevamente.',
      statusCode: 401,
    });
    expect(tokenStore.clear).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('interpreta como lista vacía el 404 de escenarios', async () => {
    const client = new VigiaApiClient('https://api.example.org', undefined, createTokenStore());
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 404 }));

    await expect(client.getScenarios()).resolves.toEqual([]);
  });

  it.each([
    [400, 'El servidor rechazó los datos. Revisa los filtros e inténtalo de nuevo.'],
    [403, 'Tu rol no permite realizar esta acción.'],
    [409, 'El registro ya existe o el paso fue confirmado previamente. Actualiza la información e inténtalo de nuevo.'],
    [422, 'El servidor rechazó los datos. Revisa los filtros e inténtalo de nuevo.'],
    [429, 'Demasiados intentos. Espera 15 minutos antes de volver a intentar.'],
    [503, 'El servidor central encontró un error. Intenta nuevamente.'],
  ])('traduce HTTP %i', async (status, message) => {
    const client = new VigiaApiClient('https://api.example.org', undefined, createTokenStore());
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status }));

    await expect(client.getDevices()).rejects.toMatchObject({ message, statusCode: status });
  });

  it('publica exportaciones solo por POST en el endpoint auditado', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ records: [] }), { status: 200 }),
    );
    const client = new VigiaApiClient('https://api.example.org', undefined, createTokenStore());

    await expect(client.exportQuery('query/1')).resolves.toEqual({ records: [] });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.org/api/v1/queries/query%2F1/export',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('presenta un conflicto duplicado con instrucciones claras', async () => {
    const client = new VigiaApiClient('https://api.example.org', undefined, createTokenStore());
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 409 }));

    await expect(client.createEdge({
      cameraId: 'CAM-01',
      name: 'Cámara',
      lat: 11,
      lng: -74,
    })).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(/ya existe|confirmado previamente/i),
    });
  });

  it('confirma y quita el veredicto de un paso con los endpoints del backend', async () => {
    const result = {
      query: {
        id: 'query-1', lat: 11, lng: -74, radius_m: 500,
        time_from: '2026-03-01T10:00:00Z', time_to: '2026-03-01T11:00:00Z',
        created_at: '2026-03-01T11:01:00Z',
      },
      nearby_devices: [],
      candidate_detection_count: 1,
      routes: [{
        id: 'route-1', rank: 1, confidence: 0.9, has_distant_gaps: false,
        camera_ids: ['CAM-01'], vehicle_type: 'car', detections: [{
          sequence_order: 1, detection_id: 'detection-1', camera_id: 'CAM-01', vehicle_type: 'car',
          color: 'white', direction: 'indeterminada', confidence: 0.9,
          observed_at: '2026-03-01T10:30:00Z', has_thumbnail: true,
          license_plate: 'ABC123', confirmation: 'match',
        }],
        explanation: {},
      }],
    };
    const fetch = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(result), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(result), { status: 200 }));
    const client = new VigiaApiClient('https://api.example.org', undefined, createTokenStore());

    await expect(client.confirmDetection('query-1', 'detection-1', 'match'))
      .resolves.toMatchObject({ routes: [{ detections: [{ license_plate: 'ABC123', confirmation: 'match', has_thumbnail: true }] }] });
    await client.clearDetectionConfirmation('query-1', 'detection-1');
    expect(fetch).toHaveBeenNthCalledWith(1, expect.stringContaining('/api/v1/queries/query-1/confirmations/detection-1'), expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ verdict: 'match' }),
    }));
    expect(fetch).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/v1/queries/query-1/confirmations/detection-1'), expect.objectContaining({
      method: 'DELETE',
    }));
  });

  it('expone el timeout de 15 segundos como error entendible', async () => {
    jest.useFakeTimers();
    try {
      const client = new VigiaApiClient('https://api.example.org', undefined, createTokenStore());
      jest.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }));
      const request = client.getDevices();
      const assertion = expect(request).rejects.toMatchObject({
        message: 'El servidor no respondió a tiempo. Revisa la URL y la conexión.',
      });
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(15_000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('URL del backend', () => {
  it('permite HTTPS público y HTTP solo en hosts locales', () => {
    expect(validateBackendUrl('https://api.example.org')).toBeNull();
    expect(validateBackendUrl('http://10.0.2.2:8000')).toBeNull();
    expect(validateBackendUrl('http://example.org')).toMatch(/HTTPS/);
    expect(() => new VigiaApiClient('ftp://api.example.org')).toThrow(ApiError);
  });
});
