import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ApiError } from '../api/client';
import { SessionProvider, useSession } from './session';

const mockSecureStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => { mockSecureStore.set(key, value); }),
  deleteItemAsync: jest.fn(async (key: string) => { mockSecureStore.delete(key); }),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));
jest.mock('../storage/flutterMigration', () => ({ migrateFlutterData: jest.fn(async () => undefined) }));

function SessionActions() {
  const { devices, login, deleteDevice } = useSession();
  const [failure, setFailure] = useState<string | null>(null);
  return (
    <View>
      <Text>{devices.map((device) => device.external_id).join(',') || 'Sin cámaras'}</Text>
      {failure ? <Text>{failure}</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => void login('admin@example.org', 'password')}>
        <Text>Iniciar prueba</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => void deleteDevice('device-1').catch((reason: unknown) => {
          setFailure(reason instanceof ApiError ? String(reason.statusCode) : 'error');
        })}
      >
        <Text>Eliminar prueba</Text>
      </Pressable>
    </View>
  );
}

afterEach(() => {
  jest.restoreAllMocks();
  mockSecureStore.clear();
});

describe('SessionProvider.deleteDevice', () => {
  it.each([204, 404])('actualiza devices tras DELETE %i', async (deleteStatus) => {
    mockSecureStore.clear();
    let deviceGets = 0;
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/v1/auth/login')) {
        return new Response(JSON.stringify({
          token: 'session-token',
          user: { id: 'admin-1', email: 'admin@example.org', display_name: 'Admin', role: 'admin' },
        }), { status: 200 });
      }
      if (url.endsWith('/api/v1/devices') && method === 'GET') {
        deviceGets++;
        const items = deviceGets === 1 ? [{
          id: 'device-1', external_id: 'CAM-01', name: 'Cámara', kind: 'physical',
          status: 'online', lat: 11, lng: -74,
        }] : [];
        return new Response(JSON.stringify({ items }), { status: 200 });
      }
      if (url.endsWith('/api/v1/scenarios')) return new Response(JSON.stringify({ items: [] }), { status: 200 });
      if (url.endsWith('/api/v1/devices/device-1') && method === 'DELETE') {
        return new Response(null, { status: deleteStatus });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const screen = await render(<SessionProvider><SessionActions /></SessionProvider>);

    await fireEvent.press(screen.getByRole('button', { name: 'Iniciar prueba' }));
    await waitFor(() => expect(screen.getByText('CAM-01')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: 'Eliminar prueba' }));

    await waitFor(() => expect(screen.getByText('Sin cámaras')).toBeTruthy());
    expect(deviceGets).toBe(2);
    if (deleteStatus === 404) expect(await screen.findByText('404')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      'http://10.0.2.2:8000/api/v1/devices/device-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    await screen.unmount();
  });
});
