import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { SessionProvider, useSession } from '../state/session';
import type { RootStackParamList } from '../types/navigation';
import { LoginScreen } from './LoginScreen';
import { CamerasScreen } from './CamerasScreen';

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
jest.mock('@maplibre/maplibre-react-native', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const MockMapElement = ({ children }: import('react').PropsWithChildren) =>
    React.createElement(View, null, children);
  return {
    Map: MockMapElement,
    Camera: MockMapElement,
    GeoJSONSource: MockMapElement,
    Layer: MockMapElement,
  };
});

const Stack = createNativeStackNavigator<RootStackParamList>();

afterEach(() => {
  jest.restoreAllMocks();
  mockSecureStore.clear();
});

function TestApp() {
  const { user } = useSession();
  return (
    <NavigationContainer>
      <Stack.Navigator>
        {user ? (
          <Stack.Screen name="Operator" component={CamerasScreen} />
        ) : (
          <Stack.Screen name="Login">
            {(props) => <LoginScreen {...props} />}
          </Stack.Screen>
        )}
        <Stack.Screen name="CameraMode" component={CamerasScreen} />
        <Stack.Screen name="EdgeMode" component={CamerasScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

describe('sesión y navegación móvil', () => {
  it('muestra el login y permite entrar a una demo identificada', async () => {
    const screen = await render(<SessionProvider><TestApp /></SessionProvider>);
    await waitFor(() => expect(screen.getByText('Consola del operador')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: 'Explorar demo' }));
    await waitFor(() => expect(screen.getByText('4 cámaras registradas')).toBeTruthy());
    expect(screen.getByText('DEMOSTRACIÓN')).toBeTruthy();
    expect(screen.getByText(/Trayectorias estimadas/)).toBeTruthy();
  });

  it('presenta errores de autenticación en español y no cambia a demo', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'unauthorized' }), { status: 401 }),
    );
    const screen = await render(<SessionProvider><TestApp /></SessionProvider>);
    await waitFor(() => expect(screen.getByText('Consola del operador')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'persona@example.org');
    await fireEvent.changeText(screen.getByLabelText('Contraseña'), 'mal');
    await fireEvent.press(screen.getByRole('button', { name: 'Iniciar sesión' }));
    await waitFor(() => expect(screen.getByText('Correo o contraseña incorrectos.')).toBeTruthy());
    expect(screen.queryByText('DEMOSTRACIÓN')).toBeNull();
  });

  it.each(['operator', 'admin'] as const)('solo muestra Agregar edge al rol %s', async (role) => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/login')) {
        return new Response(JSON.stringify({
          token: 'session-token',
          user: { id: 'user-1', email: 'persona@example.org', display_name: 'Persona', role },
        }), { status: 200 });
      }
      if (url.endsWith('/api/v1/devices') || url.endsWith('/api/v1/scenarios')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const screen = await render(<SessionProvider><TestApp /></SessionProvider>);
    await waitFor(() => expect(screen.getByText('Consola del operador')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'persona@example.org');
    await fireEvent.changeText(screen.getByLabelText('Contraseña'), 'correcta');
    await fireEvent.press(screen.getByRole('button', { name: 'Iniciar sesión' }));
    await waitFor(() => expect(screen.getByText('0 cámaras registradas')).toBeTruthy());
    if (role === 'admin') {
      expect(screen.getByText('Agregar edge')).toBeTruthy();
    } else {
      expect(screen.queryByText('Agregar edge')).toBeNull();
    }
  });
});
