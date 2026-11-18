import { Platform } from 'react-native';
import type { ViewProps } from 'react-native';
import { requireNativeView } from 'expo';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { ComponentType } from 'react';

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
    throw new Error('El servidor MJPEG nativo no está disponible en esta compilación de VIGÍA.');
  }
  return new MjpegService(native);
}

export interface CameraStreamViewProps extends ViewProps {
  /** Opens the back camera and feeds every frame to the MJPEG server. */
  active: boolean;
  fps: number;
  extraRotation: number;
  onCameraStarted?: () => void;
  onCameraError?: (event: { nativeEvent: { message: string } }) => void;
}

/**
 * Native preview + capture: frames are encoded to JPEG in Kotlin and never
 * cross the bridge, like the Flutter image stream. Android only.
 */
export const CameraStreamView: ComponentType<CameraStreamViewProps> | null =
  Platform.OS === 'android' ? requireNativeView<CameraStreamViewProps>('VigiaCameraServer') : null;
