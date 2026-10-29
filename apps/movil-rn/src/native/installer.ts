import { requireOptionalNativeModule } from 'expo-modules-core';

export interface ApkInstallResult {
  permissionRequired: boolean;
}

export interface NativeApkInstaller {
  openApkInstaller(fileUri: string, expectedSha256: string): Promise<ApkInstallResult>;
}

export class ApkInstaller {
  constructor(private readonly native: NativeApkInstaller) {}

  open(fileUri: string, expectedSha256: string): Promise<ApkInstallResult> {
    let apkUrl: URL;
    try {
      apkUrl = new URL(fileUri);
    } catch {
      throw new Error('El APK verificado no tiene una ruta de archivo válida.');
    }
    if (apkUrl.protocol !== 'file:' || !apkUrl.pathname.toLowerCase().endsWith('.apk')) {
      throw new Error('Solo se puede abrir un APK local después de verificarlo.');
    }
    if (!/^[0-9a-f]{64}$/i.test(expectedSha256)) {
      throw new Error('La publicación no incluye una huella SHA-256 válida.');
    }
    return this.native.openApkInstaller(fileUri, expectedSha256);
  }
}

export async function openVerifiedApk(fileUri: string, expectedSha256: string): Promise<ApkInstallResult> {
  const native = requireOptionalNativeModule<NativeApkInstaller>('VigiaCameraServer');
  if (!native) {
    throw new Error('La instalación de APK está disponible solo en Android.');
  }
  return new ApkInstaller(native).open(fileUri, expectedSha256);
}
