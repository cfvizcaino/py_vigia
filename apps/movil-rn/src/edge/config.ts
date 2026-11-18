import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

import { validateBackendUrl } from '../api/client';
import { buildEnvelope, uuidV4 } from './envelope';
import { secureStorage } from '../storage/secure';

const edgeConfigurationKey = 'vigia_edge_configuration';

export interface EdgeConfiguration {
  cameraId: string;
  serverUrl: string;
  token: string;
}

export function validateEdgeServerUrl(value: string): string | null {
  return validateBackendUrl(value);
}

export async function loadEdgeConfiguration(): Promise<Omit<EdgeConfiguration, 'token'> & { hasToken: boolean }> {
  const [saved, token] = await Promise.all([
    AsyncStorage.getItem(edgeConfigurationKey),
    secureStorage.readEdgeToken(),
  ]);
  const configuration = parseStoredConfiguration(saved);
  return {
    cameraId: configuration?.cameraId ?? '',
    serverUrl: configuration?.serverUrl ?? '',
    hasToken: Boolean(token),
  };
}

export async function saveEdgeConfiguration(input: EdgeConfiguration): Promise<void> {
  const cameraId = input.cameraId.trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(cameraId)) {
    throw new Error('El identificador de cámara solo puede contener letras, números, punto, guion y guion bajo.');
  }
  const serverUrl = input.serverUrl.trim().replace(/\/+$/, '');
  const issue = validateEdgeServerUrl(serverUrl);
  if (issue) throw new Error(issue);
  let token = input.token.trim();
  if (!token) token = (await secureStorage.readEdgeToken()) ?? '';
  if (!token) throw new Error('Ingresa el token de edge emitido por un administrador.');

  const previousToken = await secureStorage.readEdgeToken();
  await secureStorage.writeEdgeToken(token);
  try {
    await AsyncStorage.setItem(edgeConfigurationKey, JSON.stringify({ cameraId, serverUrl }));
  } catch (error) {
    if (previousToken) await secureStorage.writeEdgeToken(previousToken);
    else await secureStorage.clearEdgeToken();
    throw error;
  }
}

export async function readEdgeConfiguration(): Promise<EdgeConfiguration | null> {
  const [saved, token] = await Promise.all([
    AsyncStorage.getItem(edgeConfigurationKey),
    secureStorage.readEdgeToken(),
  ]);
  const configuration = parseStoredConfiguration(saved);
  if (!configuration || !token) return null;
  return { ...configuration, token };
}

export async function verifyEdgeToken(input: Pick<EdgeConfiguration, 'cameraId' | 'serverUrl' | 'token'>): Promise<void> {
  const cameraId = input.cameraId.trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(cameraId)) {
    throw new Error('El identificador de cámara no es válido.');
  }
  const serverUrl = input.serverUrl.trim().replace(/\/+$/, '');
  const issue = validateEdgeServerUrl(serverUrl);
  if (issue) throw new Error(issue);
  const token = input.token.trim();
  if (!token) throw new Error('Ingresa el token de edge emitido por un administrador.');
  const sessionId = uuidV4(Crypto.getRandomBytes(16));
  const envelope = buildEnvelope({
    cameraId,
    sessionId,
    sequenceNumber: 1,
    frameNumber: 0,
    modelName: 'vigia-token-verification',
    modelDigest: null,
    tracks: [],
    generatedAt: Date.now(),
    eventId: uuidV4(Crypto.getRandomBytes(16)),
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${serverUrl}/api/v1/ingest/detections`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Vigia-Device-Token': token,
        'User-Agent': 'vigia-edge-movil/1.1',
      },
      body: JSON.stringify(envelope),
    });
    if (response.ok) return;
    if (response.status === 401 || response.status === 403) throw new Error('El servidor rechazó el token de edge (401/403).');
    if (response.status === 404) throw new Error('No se encontró la cámara o la ruta de recepción (404).');
    if (response.status === 409) throw new Error('El envelope de verificación ya existe (409); revisa la sesión configurada.');
    if (response.status >= 500) throw new Error(`El servidor edge no está disponible (${response.status}).`);
    throw new Error(`No se pudo verificar el token de edge (${response.status}).`);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Se agotó el tiempo de espera al verificar el token (10 s).');
    }
    if (error instanceof TypeError) {
      throw new Error('No fue posible conectar con el servidor edge. Verifica la URL y la red.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseStoredConfiguration(value: string | null): Omit<EdgeConfiguration, 'token'> | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') throw new TypeError();
    const cameraId = Reflect.get(parsed, 'cameraId');
    const serverUrl = Reflect.get(parsed, 'serverUrl');
    if (typeof cameraId !== 'string' || typeof serverUrl !== 'string') throw new TypeError();
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(cameraId) || validateEdgeServerUrl(serverUrl)) throw new TypeError();
    return { cameraId, serverUrl };
  } catch {
    throw new Error('La configuración Edge guardada está dañada. Vuelve a verificarla y guardarla.');
  }
}
