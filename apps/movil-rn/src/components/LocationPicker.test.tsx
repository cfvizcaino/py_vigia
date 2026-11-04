import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { describe, expect, it, jest } from '@jest/globals';

import * as Location from 'expo-location';

import { LocationPicker } from './LocationPicker';

jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  PermissionStatus: { DENIED: 'denied' },
  hasServicesEnabledAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));
jest.mock('@maplibre/maplibre-react-native', () => {
  const mockReact = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const MockElement = ({ children }: import('react').PropsWithChildren) =>
    mockReact.createElement(View, null, children);
  return { Map: MockElement, Camera: MockElement, GeoJSONSource: MockElement, Layer: MockElement };
});

describe('selector de ubicación', () => {
  it('explica que el servicio de ubicación está desactivado', async () => {
    jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(false);
    const screen = await render(<LocationPicker devices={[]} point={undefined} height={180} onChange={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Usar mi ubicación' }));
    await waitFor(() => expect(screen.getByText(/Activa la ubicación del teléfono/)).toBeTruthy());
  });

  it('ofrece Ajustes cuando el permiso fue denegado para siempre', async () => {
    jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(true);
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({
      status: Location.PermissionStatus.DENIED,
      granted: false,
      canAskAgain: false,
      expires: 'never',
    });
    const requestPermission = jest.mocked(Location.requestForegroundPermissionsAsync);
    const screen = await render(<LocationPicker devices={[]} point={undefined} height={180} onChange={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Usar mi ubicación' }));
    await waitFor(() => expect(screen.getByText(/denegado permanentemente/)).toBeTruthy());
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
