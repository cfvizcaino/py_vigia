import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { SessionProvider, useSession } from '../state/session';
import type { RootStackParamList, TabParamList } from '../types/navigation';
import { HistoryScreen } from './HistoryScreen';
import { LoginScreen } from './LoginScreen';
import { QueryScreen } from './QueryScreen';
import { ResultsScreen } from './ResultsScreen';
import { SettingsScreen } from './SettingsScreen';
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
  const mockReact = jest.requireActual<typeof import('react')>('react');
  const { View: MockView } = jest.requireActual<typeof import('react-native')>('react-native');
  const MockElement = ({ children }: import('react').PropsWithChildren) =>
    mockReact.createElement(MockView, null, children);
  return { Map: MockElement, Camera: MockElement, GeoJSONSource: MockElement, Layer: MockElement };
});
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

const Root = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<TabParamList>();

function OperatorTabs() {
  return (
    <Tabs.Navigator>
      <Tabs.Screen name="Cameras" component={CamerasScreen} />
      <Tabs.Screen name="Query" component={QueryScreen} />
      <Tabs.Screen name="Results" component={ResultsScreen} />
      <Tabs.Screen name="History" component={HistoryScreen} />
      <Tabs.Screen name="Settings" component={SettingsScreen} />
    </Tabs.Navigator>
  );
}

function TestApp() {
  const { user } = useSession();
  return (
    <NavigationContainer>
      <Root.Navigator>
        {user
          ? <Root.Screen name="Operator" component={OperatorTabs} options={{ headerShown: false }} />
          : <Root.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />}
      </Root.Navigator>
    </NavigationContainer>
  );
}

afterEach(() => {
  jest.restoreAllMocks();
  mockSecureStore.clear();
});

describe('consulta de trayectorias', () => {
  it('carga el escenario S01 en el formulario y envía el horario Bogotá convertido a UTC', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/login')) {
        return new Response(JSON.stringify({
          token: 'session-token',
          user: { id: 'user-1', email: 'persona@example.org', display_name: 'Persona', role: 'operator' },
        }), { status: 200 });
      }
      if (url.endsWith('/api/v1/devices')) {
        return new Response(JSON.stringify({
          items: [{
            id: 'device-1', external_id: 'CAM-01', name: 'Cámara norte', kind: 'physical',
            status: 'online', lat: 11.01, lng: -74.81, camera_model: null,
          }],
        }), { status: 200 });
      }
      if (url.endsWith('/api/v1/scenarios')) {
        return new Response(JSON.stringify({
          items: [{
            id: 'S01', title: 'Entrada norte', camera_id: 'CAM-01', radius_m: 750,
            date: '2026-03-01', time_from: '10:15', time_to: '11:15',
            vehicle_type: 'motorcycle', color: 'red',
          }],
        }), { status: 200 });
      }
      if (url.includes('/api/v1/queries?')) {
        return new Response(JSON.stringify({
          query: {
            id: 'query-1', lat: 11.01, lng: -74.81, radius_m: 750,
            time_from: '2026-03-01T15:15:00.000Z', time_to: '2026-03-01T16:15:00.000Z',
            vehicle_type: 'motorcycle', color: 'red', created_at: '2026-03-01T16:20:00.000Z',
          },
          nearby_devices: [],
          candidate_detection_count: 0,
          routes: [],
        }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const screen = await render(<SessionProvider><TestApp /></SessionProvider>);
    await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'persona@example.org');
    await fireEvent.changeText(screen.getByLabelText('Contraseña'), 'correcta');
    await fireEvent.press(screen.getByRole('button', { name: 'Iniciar sesión' }));
    await waitFor(() => expect(screen.getByText('1 cámaras registradas')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: /Query, tab/ }));
    expect(screen.getByText('ⓘ  Trayectorias estimadas; no constituyen una identificación confirmada')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'S01 · Entrada norte' }));
    expect(screen.getByLabelText('Fecha (Bogotá): 2026-03-01')).toBeTruthy();
    expect(screen.getByLabelText('Desde (hora Bogotá): 10:15')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Consultar trayectorias' }));
    await waitFor(() => expect(screen.getByText('0 rutas candidatas')).toBeTruthy());
    const queryCall = fetch.mock.calls.find(([input]) => String(input).includes('/api/v1/queries?'));
    const requestUrl = new URL(String(queryCall?.[0]));
    expect(requestUrl.searchParams.get('time_from')).toBe('2026-03-01T15:15:00.000Z');
    expect(requestUrl.searchParams.get('time_to')).toBe('2026-03-01T16:15:00.000Z');
    expect(requestUrl.searchParams.get('vehicle_type')).toBe('motorcycle');
    expect(requestUrl.searchParams.get('color')).toBe('red');
  });

  it('permite consultar el dataset en demo sin red y conserva avisos visibles', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch');
    const screen = await render(<SessionProvider><TestApp /></SessionProvider>);
    await fireEvent.press(screen.getByRole('button', { name: 'Explorar demo' }));
    await waitFor(() => expect(screen.getByText('4 cámaras registradas')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: /Query, tab/ }));
    expect(screen.getByText('DEMOSTRACIÓN')).toBeTruthy();
    expect(screen.getByText(/Trayectorias estimadas/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Consultar trayectorias' }));
    await waitFor(() => expect(screen.getByText('1 ruta candidata')).toBeTruthy());
    expect(screen.getByText('DEMOSTRACIÓN')).toBeTruthy();
    expect(screen.getByText(/Trayectorias estimadas/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /Results, tab/ }));
    expect(screen.getByText(/Automóvil\s*·\s*blanco/)).toBeTruthy();
    expect(screen.getByText(/Explicación: detección 35% · tiempo 40% · apariencia 15% · vía 10%/)).toBeTruthy();
    expect(screen.getAllByText(/confianza \d+%/)).toHaveLength(7);
    expect(fetch).not.toHaveBeenCalled();
  });
});
