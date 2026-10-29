import { requireOptionalNativeModule } from 'expo-modules-core';

export type CameraLink = 'usb' | 'lan';

export interface MjpegStatus {
  running: boolean;
  port: number;
  clients: number;
  frames: number;
  fps: number;
}

export interface NativeMjpegModule {
  start(host: string, port: number, accessKey: string | null): Promise<string>;
  publishJpegFile(path: string, rotation: number): Promise<void>;
  getStatus(): MjpegStatus;
  getLocalAddresses(): string[];
  stop(): Promise<void>;
}

export class MjpegService {
  constructor(private readonly native: NativeMjpegModule) {}

  start(link: CameraLink, accessKey: string): Promise<string> {
    if (link === 'lan' && accessKey.trim().length < 12) {
      throw new Error('La clave de red local debe tener al menos 12 caracteres.');
    }
    return this.native.start(link === 'usb' ? '127.0.0.1' : '0.0.0.0', 8080, link === 'lan' ? accessKey : null);
  }

  publishJpegFile(path: string, rotation: number): Promise<void> {
    if (!path.trim()) throw new Error('No se recibió la ruta temporal del JPEG.');
    if (![0, 90, 180, 270].includes(rotation)) throw new Error('La rotación debe ser 0, 90, 180 o 270 grados.');
    return this.native.publishJpegFile(path, rotation);
  }

  getStatus(): MjpegStatus {
    return this.native.getStatus();
  }

  getLocalAddresses(): string[] {
    return this.native.getLocalAddresses();
  }

  stop(): Promise<void> {
    return this.native.stop();
  }
}

export function createMjpegService(): MjpegService {
  const native = requireOptionalNativeModule<NativeMjpegModule>('VigiaCameraServer');
  if (!native) {
    throw new Error('El servidor MJPEG nativo solo está disponible en la compilación Android de VIGÍA.');
  }
  return new MjpegService(native);
}
