import { describe, expect, jest, test } from '@jest/globals';

import { classifyUpdate, compareVersions, downloadVerifiedApk } from './release';
import type { AppRelease } from './release';

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: jest.fn(async () => new Uint8Array(32).buffer),
}));

jest.mock('expo-file-system', () => {
  class MockDirectory {
    create() {}
  }
  class MockFile {
    exists = false;
    create() {}
    async write() { throw new Error('No debe guardar un APK sin hash válido.'); }
    delete() {}
    async move() {}
  }
  return {
    Directory: MockDirectory,
    File: MockFile,
    Paths: { cache: { uri: 'cache' } },
  };
});

describe('actualizaciones', () => {
  test('compara semver X.Y.Z e ignora versiones no válidas para no forzar', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.4.0+5', '1.4.0')).toBe(0);
    expect(compareVersions('release', '99.0.0')).toBe(0);
    expect(classifyUpdate('1.4.0', '1.5.0', '1.3.0')).toBe('optional');
    expect(classifyUpdate('1.4.0', '2.0.0', '1.5.0')).toBe('required');
    expect(classifyUpdate('1.4.0', null, null)).toBe('none');
  });

  test('no escribe ni entrega APK cuando SHA-256 difiere', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(4),
    } as Response);
    const release: AppRelease = {
      latest: '1.5.0',
      minimum: null,
      apk_url: 'https://downloads.vigia.example/vigia.apk',
      sha256: '11'.repeat(32),
      notes: '',
    };
    await expect(downloadVerifiedApk(release)).rejects.toThrow(/huella publicada/);
  });

  test('rechaza APK por HTTP antes de descargarlo', async () => {
    const release: AppRelease = {
      latest: '1.5.0',
      minimum: null,
      apk_url: 'http://downloads.vigia.example/vigia.apk',
      sha256: '00'.repeat(32),
      notes: '',
    };
    await expect(downloadVerifiedApk(release)).rejects.toThrow(/HTTPS/);
  });
});
