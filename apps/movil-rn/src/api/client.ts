import { z } from 'zod';

import { secureStorage } from '../storage/secure';
import type {
  AppUser,
  Device,
  DeviceDetection,
  EdgeCredential,
  IssuedCredential,
  QueryInput,
  QueryResult,
  Scenario,
} from '../types/models';

const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  display_name: z.string(),
  role: z.enum(['operator', 'admin']),
});
const deviceSchema = z.object({
  id: z.string(),
  external_id: z.string(),
  name: z.string(),
  kind: z.string(),
  status: z.string(),
  lat: z.number(),
  lng: z.number(),
  camera_model: z.string().nullable().default(null),
});
const scenarioSchema = z.object({
  id: z.string(),
  title: z.string(),
  camera_id: z.string(),
  radius_m: z.number(),
  date: z.string(),
  time_from: z.string(),
  time_to: z.string(),
  vehicle_type: z.string().nullable(),
  color: z.string().nullable(),
});
const deviceDetectionSchema = z.object({
  id: z.string(),
  vehicle_type: z.string(),
  color: z.string().nullable().default(null),
  direction: z.string(),
  confidence: z.number(),
  observed_at: z.string(),
});
const credentialSchema = z.object({
  id: z.string(),
  camera_id: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
  revoked: z.boolean(),
});
const nearbyDeviceSchema = z.object({
  id: z.string(),
  external_id: z.string(),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  distance_m: z.number().optional().default(0),
});
const routeDetectionSchema = z.object({
  sequence_order: z.number(),
  detection_id: z.string(),
  camera_id: z.string(),
  vehicle_type: z.string(),
  color: z.string().nullable().default(null),
  direction: z.string(),
  confidence: z.number(),
  observed_at: z.string(),
});
const candidateRouteSchema = z.object({
  id: z.string(),
  rank: z.number(),
  confidence: z.number(),
  has_distant_gaps: z.boolean(),
  camera_ids: z.array(z.string()),
  vehicle_type: z.string(),
  color: z.string().nullable().default(null),
  detections: z.array(routeDetectionSchema),
  explanation: z.record(z.string(), z.unknown()).default({}),
  road_geometry: z.record(z.string(), z.unknown()).nullable().optional(),
});
const queryResultSchema = z.object({
  query: z.object({
    id: z.union([z.string(), z.number()]),
    lat: z.number(),
    lng: z.number(),
    radius_m: z.number(),
    time_from: z.string(),
    time_to: z.string(),
    vehicle_type: z.string().nullable().default(null),
    color: z.string().nullable().default(null),
    created_at: z.string(),
  }),
  nearby_devices: z.array(nearbyDeviceSchema),
  candidate_detection_count: z.number(),
  routes: z.array(candidateRouteSchema),
});

export class ApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface TokenStore {
  read(): Promise<string | null>;
  write(token: string): Promise<void>;
  clear(): Promise<void>;
}

const secureTokenStore: TokenStore = {
  read: secureStorage.readSessionToken,
  write: secureStorage.writeSessionToken,
  clear: secureStorage.clearSessionToken,
};

export function validateBackendUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return 'Ingresa una URL válida que empiece por http:// o https:// y no incluya credenciales.';
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    return 'Ingresa una URL válida sin credenciales, parámetros ni fragmentos.';
  }
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '10.0.2.2', '10.0.3.2']);
  if (url.protocol === 'http:' && !localHosts.has(url.hostname.toLowerCase())) {
    return 'Las conexiones HTTP solo se permiten a localhost o al emulador. Usa HTTPS para otros hosts.';
  }
  return null;
}

export class VigiaApiClient {
  readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly onUnauthorized?: () => Promise<void> | void,
    private readonly tokenStore: TokenStore = secureTokenStore,
  ) {
    this.baseUrl = baseUrl.trim().replace(/\/+$/, '');
    const issue = validateBackendUrl(this.baseUrl);
    if (issue) throw new ApiError(issue, null);
  }

  async login(email: string, password: string): Promise<AppUser> {
    const response = parse(z.object({ token: z.string().min(1), user: userSchema }),
      await this.request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: email.trim(), password },
        authenticated: false,
      }),
    );
    await this.tokenStore.write(response.token);
    return response.user;
  }

  async currentUser(): Promise<AppUser> {
    return parse(z.object({ user: userSchema }), await this.request('/api/v1/auth/me')).user;
  }

  async logout(): Promise<void> {
    try {
      await this.request('/api/v1/auth/logout', { method: 'POST' });
    } finally {
      await this.tokenStore.clear();
    }
  }

  async getDevices(): Promise<Device[]> {
    return listOf(await this.request('/api/v1/devices'), deviceSchema).map((device) => ({
      ...device,
      camera_model: device.camera_model ?? null,
    }));
  }

  async getScenarios(): Promise<Scenario[]> {
    try {
      return listOf(await this.request('/api/v1/scenarios'), scenarioSchema);
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 404) return [];
      throw error;
    }
  }

  async runQuery(input: QueryInput): Promise<QueryResult> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined && value !== null) params.set(key, String(value));
    }
    return parse(queryResultSchema,
      await this.request(`/api/v1/queries?${params.toString()}`),
    );
  }

  async createEdge(input: {
    cameraId: string;
    name: string;
    lat: number;
    lng: number;
    cameraModel?: string;
  }): Promise<Device> {
    return parse(deviceSchema, await this.request('/api/v1/devices', {
      method: 'POST',
      body: {
        external_id: input.cameraId,
        name: input.name,
        kind: 'physical',
        status: 'offline',
        lat: input.lat,
        lng: input.lng,
        ...(input.cameraModel ? { camera_model: input.cameraModel } : {}),
      },
    }));
  }

  async relocateEdge(deviceId: string, lat: number, lng: number): Promise<Device> {
    return parse(deviceSchema, await this.request(`/api/v1/devices/${encodeURIComponent(deviceId)}`, {
      method: 'PATCH',
      body: { lat, lng },
    }));
  }

  async recentDetections(deviceId: string, limit = 20): Promise<DeviceDetection[]> {
    return listOf(await this.request('/api/v1/detections', {
      query: { device_id: deviceId, limit: String(limit) },
    }), deviceDetectionSchema);
  }

  async issueCredential(cameraId: string, days = 90): Promise<IssuedCredential> {
    const schema = credentialSchema.extend({ secret: z.string().min(1) });
    const parsed = parse(schema, await this.request(
      `/api/v1/admin/devices/${encodeURIComponent(cameraId)}/credentials`,
      { method: 'POST', body: { days } },
    ));
    const { secret, ...credential } = parsed;
    return { credential, secret };
  }

  async listCredentials(): Promise<EdgeCredential[]> {
    return listOf(await this.request('/api/v1/admin/credentials'), credentialSchema);
  }

  async revokeCredential(credentialId: string): Promise<void> {
    await this.request(`/api/v1/admin/credentials/${encodeURIComponent(credentialId)}`, { method: 'DELETE' });
  }

  async exportQuery(queryId: string): Promise<Record<string, unknown>> {
    return parse(z.record(z.string(), z.unknown()), await this.request(
      `/api/v1/queries/${encodeURIComponent(queryId)}/export`,
      { method: 'POST' },
    ));
  }

  private async request(
    path: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
      query?: Record<string, string>;
      authenticated?: boolean;
    } = {},
  ): Promise<unknown> {
    const { method = 'GET', body, query, authenticated = true } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const token = authenticated ? await this.tokenStore.read() : null;
      if (authenticated && !token) throw new ApiError('Inicia sesión para continuar.', 401);
      let response: Response;
      try {
        response = await fetch(url.toString(), {
          method,
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new ApiError('El servidor no respondió a tiempo. Revisa la URL y la conexión.', null);
        }
        throw new ApiError('No fue posible conectar con el servidor. Revisa la URL y la conexión.', null);
      }

      if (response.status === 401 && authenticated) {
        await this.tokenStore.clear();
        await this.onUnauthorized?.();
      }
      if (!response.ok) throw new ApiError(messageForStatus(response.status, !authenticated), response.status);
      if (response.status === 204) return undefined;
      try {
        return await response.json() as unknown;
      } catch {
        throw new ApiError('El servidor envió una respuesta inválida.', response.status);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

function listOf<T>(value: unknown, schema: z.ZodType<T>): T[] {
  const list = Array.isArray(value)
    ? value
    : parse(z.object({ items: z.array(schema) }), value).items;
  return parse(z.array(schema), list);
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof z.ZodError) throw new ApiError('El servidor envió datos inválidos.', null);
    throw error;
  }
}

function messageForStatus(status: number, loginRequest: boolean): string {
  if (status === 401) return loginRequest ? 'Correo o contraseña incorrectos.' : 'La sesión venció. Inicia sesión nuevamente.';
  if (status === 403) return 'Tu rol no permite realizar esta acción.';
  if (status === 429) return 'Demasiados intentos. Espera 15 minutos antes de volver a intentar.';
  if (status === 404) return 'No se encontró el recurso solicitado.';
  if (status === 409) return 'Ya existe un registro con ese identificador.';
  if (status === 400 || status === 422) return 'El servidor rechazó los datos. Revisa los filtros e inténtalo de nuevo.';
  if (status >= 500) return 'El servidor central encontró un error. Intenta nuevamente.';
  return `Error del servidor (${status}).`;
}
