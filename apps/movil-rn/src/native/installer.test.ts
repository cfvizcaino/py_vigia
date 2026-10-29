import { describe, expect, jest, test } from '@jest/globals';

import { ApkInstaller } from './installer';
import type { NativeApkInstaller } from './installer';

describe('instalador Android', () => {
  test('solo entrega al nativo APK local con SHA-256 válido', async () => {
    const native: NativeApkInstaller = {
      openApkInstaller: jest.fn(async () => ({ permissionRequired: false })),
    };
    const installer = new ApkInstaller(native);
    await expect(installer.open('file:///cache/updates/vigia-update.apk', 'ab'.repeat(32)))
      .resolves.toEqual({ permissionRequired: false });
    expect(native.openApkInstaller).toHaveBeenCalledWith(
      'file:///cache/updates/vigia-update.apk',
      'ab'.repeat(32),
    );
  });

  test('rechaza rutas remotas, archivos ajenos y huellas inválidas', () => {
    const native: NativeApkInstaller = {
      openApkInstaller: jest.fn(async () => ({ permissionRequired: false })),
    };
    const installer = new ApkInstaller(native);
    expect(() => installer.open('https://host.example/app.apk', 'ab'.repeat(32))).toThrow(/APK local/);
    expect(() => installer.open('file:///cache/updates/other.zip', 'ab'.repeat(32))).toThrow(/APK local/);
    expect(() => installer.open('file:///cache/updates/vigia-update.apk', 'invalid')).toThrow(/SHA-256/);
    expect(native.openApkInstaller).not.toHaveBeenCalled();
  });
});
