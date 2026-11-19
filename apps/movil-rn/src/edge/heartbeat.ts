/**
 * Latido del edge: le dice al centro si este teléfono sigue detectando.
 *
 * Mientras el edge corre envía `running` cada 30 s con el ritmo de análisis y la cola.
 * Al pasar a segundo plano envía `paused` y al detener el edge, `stopped`. Si la app se
 * cierra a la fuerza o el teléfono se queda sin red o sin batería, los latidos dejan de
 * llegar y la consola lo muestra como «sin señal» a los 90 s (backend: liveness.py).
 *
 * Un latido perdido no se reintenta ni se encola: el siguiente lo reemplaza.
 */

export type HeartbeatState = 'running' | 'paused' | 'stopped';

export interface HeartbeatReading {
  analysesPerSecond: number;
  activeTracks: number;
  pendingEvents: number;
  deliveredEvents: number;
  lastError: string | null;
}

export interface HeartbeatOptions {
  serverUrl: string;
  token: string;
  cameraId: string;
  sessionId: string;
  nodeVersion: string;
  platform: string;
  read: () => HeartbeatReading | null;
  readBattery?: () => Promise<number | null>;
  fetcher?: typeof fetch;
  intervalMs?: number;
  timeoutMs?: number;
  onUnauthorized?: () => void;
}

export const heartbeatIntervalMs = 30_000;

export class Heartbeat {
  private timer: ReturnType<typeof setInterval> | null = null;
  private state: HeartbeatState = 'stopped';

  constructor(private readonly options: HeartbeatOptions) {}

  get beating(): boolean {
    return this.timer !== null;
  }

  /** Starts (or keeps) the periodic `running` heartbeat; the first one goes right away. */
  running(): void {
    this.state = 'running';
    if (this.timer) return;
    void this.send('running');
    this.timer = setInterval(() => void this.send('running'), this.options.intervalMs ?? heartbeatIntervalMs);
  }

  /** The app went to the background: the edge stops analysing until it comes back. */
  pause(): Promise<boolean> {
    return this.finish('paused');
  }

  /** The operator stopped the edge (or left its screen). */
  stop(): Promise<boolean> {
    return this.finish('stopped');
  }

  invalidate(): void {
    this.clear();
    this.state = 'stopped';
  }

  private finish(state: HeartbeatState): Promise<boolean> {
    this.clear();
    if (this.state === state) return Promise.resolve(true);
    this.state = state;
    return this.send(state);
  }

  private clear(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async send(state: HeartbeatState): Promise<boolean> {
    const { serverUrl, token, cameraId, sessionId, nodeVersion, platform } = this.options;
    const reading = this.options.read();
    const battery = await this.readBattery();
    const body = {
      cameraId,
      sessionId,
      state,
      nodeVersion,
      platform,
      ...(reading ? {
        analysesPerSecond: Math.round(reading.analysesPerSecond * 10) / 10,
        activeTracks: reading.activeTracks,
        pendingEvents: reading.pendingEvents,
        deliveredEvents: reading.deliveredEvents,
        lastError: reading.lastError ? reading.lastError.slice(0, 120) : null,
      } : {}),
      ...(battery === null ? {} : { battery }),
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 8_000);
    try {
      const response = await (this.options.fetcher ?? fetch)(`${serverUrl.replace(/\/+$/, '')}/api/v1/ingest/heartbeat`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Vigia-Device-Token': token,
          'User-Agent': 'vigia-edge-movil/1.1',
        },
        body: JSON.stringify(body),
      });
      if (response.status === 401) {
        this.invalidate();
        this.options.onUnauthorized?.();
        return false;
      }
      return response.ok;
    } catch {
      // No network: the outbox already reports it on screen; the next beat tries again.
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readBattery(): Promise<number | null> {
    if (!this.options.readBattery) return null;
    try {
      const level = await this.options.readBattery();
      return level !== null && level >= 0 && level <= 1 ? Math.round(level * 100) / 100 : null;
    } catch {
      return null;
    }
  }
}
