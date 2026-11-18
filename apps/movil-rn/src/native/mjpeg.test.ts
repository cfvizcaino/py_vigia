import { describe, expect, jest, test } from '@jest/globals';

import { MjpegService } from './mjpeg';
import type { NativeMjpegModule } from './mjpeg';

jest.mock('expo', () => ({
  ...jest.requireActual<object>('expo'),
  requireNativeView: jest.fn(() => 'CameraStreamView'),
}));

describe('adaptador MJPEG', () => {
  test('USB enlaza solo loopback y LAN exige clave', async () => {
    const native: NativeMjpegModule = {
      start: jest.fn(async () => '0.0.0.0'),
      getStatus: jest.fn(() => ({ running: true, port: 8080, clients: 1, frames: 2, fps: 1 })),
      getLocalAddresses: jest.fn(() => ['192.168.1.4']),
      stop: jest.fn(async () => undefined),
    };
    const service = new MjpegService(native);

    await service.start('usb', '');
    expect(native.start).toHaveBeenLastCalledWith('127.0.0.1', 8080, null);
    expect(() => service.start('lan', 'short')).toThrow(/12 caracteres/);
    await service.start('lan', 'abcdefghjkmn');
    expect(native.start).toHaveBeenLastCalledWith('0.0.0.0', 8080, 'abcdefghjkmn');
  });
});
