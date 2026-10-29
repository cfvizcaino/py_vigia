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
    [409, 'Ya existe un registro con ese identificador.'],
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
});

describe('URL del backend', () => {
  it('permite HTTPS público y HTTP solo en hosts locales', () => {
    expect(validateBackendUrl('https://api.example.org')).toBeNull();
    expect(validateBackendUrl('http://10.0.2.2:8000')).toBeNull();
    expect(validateBackendUrl('http://example.org')).toMatch(/HTTPS/);
    expect(() => new VigiaApiClient('ftp://api.example.org')).toThrow(ApiError);
  });
});
