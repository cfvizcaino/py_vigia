import { describe, expect, it, jest } from '@jest/globals';

import { createUnauthorizedHandler } from './unauthorized';

describe('parada ante token edge revocado', () => {
  it('detiene heartbeat y runtime, borra el token y notifica una sola vez', async () => {
    const calls: string[] = [];
    const onUnauthorized = jest.fn(() => { calls.push('notice'); });
    const handler = createUnauthorizedHandler({
      stopHeartbeat: () => { calls.push('heartbeat'); },
      stopRuntime: jest.fn(async () => { calls.push('runtime'); }),
      clearToken: jest.fn(async () => { calls.push('token'); }),
      onUnauthorized,
      onCleanupError: jest.fn(),
    });

    handler();
    handler();
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toEqual(['heartbeat', 'runtime', 'token', 'notice']);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
