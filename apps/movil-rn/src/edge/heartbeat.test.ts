import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { Heartbeat } from './heartbeat';
import type { HeartbeatOptions } from './heartbeat';

function setup(overrides: Partial<HeartbeatOptions> = {}) {
  const bodies: Record<string, unknown>[] = [];
  const urls: string[] = [];
  const fetcher = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url));
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return { ok: true } as Response;
  }) as unknown as typeof fetch;
  const heartbeat = new Heartbeat({
    serverUrl: 'https://vigia.test/',
    token: 'secreto',
    cameraId: 'CEL-02',
    sessionId: 's-1',
    nodeVersion: '1.5.0',
    platform: 'android',
    read: () => ({ analysesPerSecond: 6.234, activeTracks: 2, pendingEvents: 4, deliveredEvents: 90, lastError: null }),
    readBattery: async () => 0.8312,
    fetcher,
    intervalMs: 1000,
    ...overrides,
  });
  return { heartbeat, bodies, urls, fetcher };
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('latido del edge', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('envía running al iniciar y cada intervalo, con ritmo, cola y batería', async () => {
    const { heartbeat, bodies, urls } = setup();
    heartbeat.running();
    await flush();
    expect(urls[0]).toBe('https://vigia.test/api/v1/ingest/heartbeat');
    expect(bodies[0]).toMatchObject({
      cameraId: 'CEL-02', state: 'running', nodeVersion: '1.5.0', analysesPerSecond: 6.2,
      activeTracks: 2, pendingEvents: 4, deliveredEvents: 90, battery: 0.83,
    });
    jest.advanceTimersByTime(1000);
    await flush();
    jest.advanceTimersByTime(1000);
    await flush();
    expect(bodies.map((b) => b.state)).toEqual(['running', 'running', 'running']);
    // Calling running() again while beating does not start a second timer.
    heartbeat.running();
    jest.advanceTimersByTime(1000);
    await flush();
    expect(bodies).toHaveLength(4);
  });

  test('segundo plano y detener envían un aviso y paran el intervalo', async () => {
    const { heartbeat, bodies } = setup();
    heartbeat.running();
    await flush();
    await heartbeat.pause();
    expect(heartbeat.beating).toBe(false);
    jest.advanceTimersByTime(5000);
    await flush();
    expect(bodies.map((b) => b.state)).toEqual(['running', 'paused']);
    // Pausing twice does not repeat the notice; stopping after a pause does send it.
    await heartbeat.pause();
    await heartbeat.stop();
    expect(bodies.map((b) => b.state)).toEqual(['running', 'paused', 'stopped']);
  });

  test('sin red no lanza error y el siguiente latido lo vuelve a intentar', async () => {
    const fetcher = jest.fn(async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch;
    const { heartbeat } = setup({ fetcher, readBattery: async () => { throw new Error('sin sensor'); } });
    await expect(heartbeat.send('running')).resolves.toBe(false);
  });

  test('un 401 invalida el heartbeat, detiene el intervalo y avisa una sola vez', async () => {
    const fetcher = jest.fn(async () => new Response(null, { status: 401 }));
    const onUnauthorized = jest.fn();
    const { heartbeat } = setup({ fetcher, onUnauthorized });

    heartbeat.running();
    await flush();
    expect(heartbeat.beating).toBe(false);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledWith(401);
    jest.advanceTimersByTime(5000);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('un 403 (token de otra cámara) también detiene el heartbeat', async () => {
    const fetcher = jest.fn(async () => new Response(null, { status: 403 }));
    const onUnauthorized = jest.fn();
    const { heartbeat } = setup({ fetcher, onUnauthorized });

    heartbeat.running();
    await flush();
    expect(heartbeat.beating).toBe(false);
    expect(onUnauthorized).toHaveBeenCalledWith(403);
  });
});
