import { render } from '@testing-library/react-native';
import { describe, expect, jest, test } from '@jest/globals';

import { CameraModeScreen } from './CameraModeScreen';

jest.mock('react-native-vision-camera', () => ({
  Camera: 'Camera',
  VisionCamera: { requestCameraPermission: jest.fn(async () => true) },
  useCameraDevice: jest.fn(() => ({ id: 'back-camera' })),
  usePhotoOutput: jest.fn(() => ({ capturePhoto: jest.fn() })),
}));

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(async () => undefined),
  deactivateKeepAwake: jest.fn(async () => undefined),
}));

describe('Modo cámara', () => {
  test('presenta el streaming local, controles y advertencia de privacidad', async () => {
    const screen = await render(<CameraModeScreen />);
    expect(screen.getByText(/el video nunca se envía al servidor central/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Iniciar transmisión' })).toBeTruthy();
    expect(screen.getByText('Fotogramas por segundo')).toBeTruthy();
    expect(screen.getByText(/\/video \(MJPEG\), \/shot\.jpg/)).toBeTruthy();
  });
});
