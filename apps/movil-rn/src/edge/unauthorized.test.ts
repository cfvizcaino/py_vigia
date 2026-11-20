import { describe, expect, it, jest } from '@jest/globals';

import { createUnauthorizedHandler } from './unauthorized';

function harness() {
  const calls: string[] = [];
  const onUnauthorized = jest.fn((status: number) => { calls.push(`notice-${status}`); });
  const handler = createUnauthorizedHandler({
    stopHeartbeat: () => { calls.push('heartbeat'); },
    stopRuntime: jest.fn(async () => { calls.push('runtime'); }),
    clearToken: jest.fn(async () => { calls.push('token'); }),
    onUnauthorized,
    onCleanupError: jest.fn(),
  });
  return { calls, handler, onUnauthorized };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('parada ante una credencial edge rechazada', () => {
  it('ante un 401 detiene heartbeat y runtime, borra el token y notifica una sola vez', async () => {
    const { calls, handler, onUnauthorized } = harness();

    handler(401);
    handler(401);
    await settle();

    expect(calls).toEqual(['heartbeat', 'runtime', 'token', 'notice-401']);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('ante un 403 (token de otra cámara) se detiene pero conserva el token', async () => {
    const { calls, handler } = harness();

    handler(403);
    handler(401);
    await settle();

    expect(calls).toEqual(['heartbeat', 'runtime', 'notice-403']);
  });
});
