import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { z } from 'zod';

const releaseSchema = z.object({
  latest: z.string().nullable(),
  minimum: z.string().nullable(),
  apk_url: z.string().nullable(),
  sha256: z.string().nullable(),
  notes: z.string().default(''),
  published_at: z.string().nullable().optional(),
});

export type AppRelease = z.infer<typeof releaseSchema>;
export type UpdateLevel = 'none' | 'optional' | 'required';

export const installedAppVersionFallback = '1.4.0';

export function compareVersions(left: string, right: string): number {
  const parse = (version: string): number[] | null => {
    const core = version.split('+')[0]?.split('-')[0];
    if (!core || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(core)) return null;
    return core.split('.').map(Number);
  };
  const leftParts = parse(left);
  const rightParts = parse(right);
  if (!leftParts || !rightParts) return 0;
  for (let index = 0; index < 3; index++) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function classifyUpdate(installed: string, latest: string | null, minimum: string | null): UpdateLevel {
  if (minimum && compareVersions(installed, minimum) < 0) return 'required';
  if (latest && compareVersions(installed, latest) < 0) return 'optional';
  return 'none';
}

export function readInstalledVersion(): string {
  return Application.nativeApplicationVersion?.trim() || installedAppVersionFallback;
}

export async function fetchAppRelease(baseUrl: string): Promise<AppRelease | null> {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/app/version`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return releaseSchema.parse(await response.json() as unknown);
  } finally {
    clearTimeout(timeout);
  }
}

export async function downloadVerifiedApk(release: AppRelease): Promise<File> {
  if (!release.apk_url || !release.sha256 || !/^[0-9a-f]{64}$/i.test(release.sha256)) {
    throw new Error('La publicación no incluye un enlace APK y una huella SHA-256 válidos.');
  }
  let url: URL;
  try {
    url = new URL(release.apk_url);
  } catch {
    throw new Error('La URL de descarga del APK no es válida.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('La descarga del APK debe usar HTTPS y no incluir credenciales en la URL.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5 * 60_000);
  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    if (!response.ok) throw new Error(`La descarga respondió ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
    const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== release.sha256.toLowerCase()) {
      throw new Error('La descarga no coincide con la huella publicada. No se instaló.');
    }

    const directory = new Directory(Paths.cache, 'updates');
    directory.create({ intermediates: true, idempotent: true });
    const temporary = new File(directory, '.vigia-update.apk.tmp');
    temporary.create({ intermediates: true, overwrite: true });
    await temporary.write(bytes);
    const apk = new File(directory, 'vigia-update.apk');
    if (apk.exists) apk.delete();
    await temporary.move(apk);
    return apk;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Se agotó el tiempo de descarga de la actualización.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
