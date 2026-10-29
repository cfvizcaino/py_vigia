import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { SessionProvider, useSession } from '../state/session';
import type { RootStackParamList } from '../types/navigation';
import { LoginScreen } from './LoginScreen';
import { CamerasScreen } from './CamerasScreen';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));
jest.mock('@maplibre/maplibre-react-native', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
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
  });

  it('presenta errores de autenticación en español y no cambia a demo', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'unauthorized' }), { status: 401 }),
    );
    const screen = await render(<SessionProvider><TestApp /></SessionProvider>);
    await waitFor(() => expect(screen.getByText('Consola del operador')).toBeTruthy());
    fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'persona@example.org');
    fireEvent.changeText(screen.getByLabelText('Contraseña'), 'mal');
    await fireEvent.press(screen.getByRole('button', { name: 'Iniciar sesión' }));
    await waitFor(() => expect(screen.getByText('Correo o contraseña incorrectos.')).toBeTruthy());
    expect(screen.queryByText('DEMOSTRACIÓN')).toBeNull();
  });
});
