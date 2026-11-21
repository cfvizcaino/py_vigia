import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { SessionProvider, useSession } from '../state/session';
import type { RootStackParamList, TabParamList } from '../types/navigation';
import { HistoryScreen } from './HistoryScreen';
import { LoginScreen } from './LoginScreen';
import { WelcomeScreen } from './WelcomeScreen';
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
          : (
            <>
              <Root.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false }} />
              <Root.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
            </>
          )}
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
          items: [
            {
              id: 'S01', title: 'Entrada norte', camera_id: 'CAM-01', radius_m: 750,
              date: '2026-03-01', time_from: '10:15', time_to: '11:15',
              vehicle_type: 'motorcycle', color: 'red',
            },
            {
              id: 'S02', title: 'Cruce nocturno', camera_id: 'CAM-01', radius_m: 750,
              date: '2026-03-01', time_from: '23:30', time_to: '00:30',
              vehicle_type: 'car', color: 'white',
            },
          ],
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
    await fireEvent.press(screen.getByRole('button', { name: 'Ir a iniciar sesión' }));
    await waitFor(() => expect(screen.getByText('¡Bienvenido de vuelta!')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'persona@example.org');
    await fireEvent.changeText(screen.getByLabelText('Contraseña'), 'correcta');
    await fireEvent.press(screen.getByRole('button', { name: 'Iniciar sesión' }));
    await waitFor(() => expect(screen.getByText('1 Cámaras Registradas')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: /Query, tab/ }));
    expect(screen.getByText('Trayectorias estimadas; no constituyen una identificación confirmada.')).toBeTruthy();
    expect(screen.queryByLabelText('Placa (opcional)')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Elegir caso del dataset' }));
    await fireEvent.press(screen.getByRole('button', { name: 'S01 · Entrada norte' }));
    expect(screen.getByLabelText('Fecha: 2026-03-01')).toBeTruthy();
    expect(screen.getByLabelText('Desde: 10:15')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Consultar trayectorias' }));
    await waitFor(() => expect(screen.getByText(/^0 rutas estimadas/)).toBeTruthy());
    const queryCall = fetch.mock.calls.find(([input]) => String(input).includes('/api/v1/queries?'));
    const requestUrl = new URL(String(queryCall?.[0]));
    expect(requestUrl.searchParams.get('time_from')).toBe('2026-03-01T15:15:00.000Z');
    expect(requestUrl.searchParams.get('time_to')).toBe('2026-03-01T16:15:00.000Z');
    expect(requestUrl.searchParams.get('vehicle_type')).toBe('motorcycle');
    expect(requestUrl.searchParams.get('color')).toBe('red');

    await fireEvent.press(screen.getByRole('button', { name: /Query, tab/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Elegir caso del dataset' }));
    await fireEvent.press(screen.getByRole('button', { name: 'S02 · Cruce nocturno' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Consultar trayectorias' }));
    await waitFor(() => expect(fetch.mock.calls.filter(([input]) => String(input).includes('/api/v1/queries?'))).toHaveLength(2));
    const overnightCall = fetch.mock.calls.filter(([input]) => String(input).includes('/api/v1/queries?'))[1];
    const overnightUrl = new URL(String(overnightCall?.[0]));
    expect(overnightUrl.searchParams.get('time_from')).toBe('2026-03-02T04:30:00.000Z');
    expect(overnightUrl.searchParams.get('time_to')).toBe('2026-03-02T05:30:00.000Z');
  });

  it('un admin filtra por placa, ve el recorte de cada paso y lo amplía', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/login')) {
        return new Response(JSON.stringify({
          token: 'session-token',
          user: { id: 'user-1', email: 'admin@example.org', display_name: 'Admin', role: 'admin' },
        }), { status: 200 });
      }
      if (url.endsWith('/api/v1/devices')) {
        return new Response(JSON.stringify({
          items: [{
            id: 'device-1', external_id: 'CEL-ALONDRA', name: 'Portería Alondra', kind: 'physical',
            status: 'online', lat: 10.99, lng: -74.84, camera_model: null,
          }],
        }), { status: 200 });
      }
      if (url.endsWith('/api/v1/scenarios')) return new Response(JSON.stringify({ items: [] }), { status: 200 });
      if (url.includes('/api/v1/queries?')) {
        return new Response(JSON.stringify({
          query: {
            id: 'query-1', lat: 10.99, lng: -74.84, radius_m: 2000,
            time_from: '2026-11-20T19:00:00.000Z', time_to: '2026-11-20T19:40:00.000Z',
            vehicle_type: 'car', color: 'white', created_at: '2026-11-20T19:45:00.000Z',
          },
          nearby_devices: [{ id: 'device-1', external_id: 'CEL-ALONDRA', name: 'Portería Alondra', lat: 10.99, lng: -74.84, distance_m: 0 }],
          candidate_detection_count: 2,
          routes: [{
            id: 'route-1', rank: 1, confidence: 0.81, has_distant_gaps: false, camera_ids: ['CEL-ALONDRA', 'CEL-ALONDRA'],
            vehicle_type: 'car', color: 'white', explanation: {}, road_geometry: null,
            detections: [
              { sequence_order: 1, detection_id: 'det-1', camera_id: 'CEL-ALONDRA', vehicle_type: 'car', color: 'white', direction: 'norte', confidence: 0.92, observed_at: '2026-11-20T19:20:05Z', has_thumbnail: true, license_plate: 'KQV159', confirmation: null },
              { sequence_order: 2, detection_id: 'det-2', camera_id: 'CEL-ALONDRA', vehicle_type: 'car', color: 'white', direction: 'norte', confidence: 0.62, observed_at: '2026-11-20T19:21:05Z', has_thumbnail: false, license_plate: null, confirmation: null },
            ],
          }],
        }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const screen = await render(<SessionProvider><TestApp /></SessionProvider>);
    await fireEvent.press(screen.getByRole('button', { name: 'Ir a iniciar sesión' }));
    await waitFor(() => expect(screen.getByText('¡Bienvenido de vuelta!')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'admin@example.org');
    await fireEvent.changeText(screen.getByLabelText('Contraseña'), 'correcta');
    await fireEvent.press(screen.getByRole('button', { name: 'Iniciar sesión' }));
    await waitFor(() => expect(screen.getByText('1 Cámaras Registradas')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: /Query, tab/ }));

    await fireEvent.changeText(screen.getByLabelText('Placa (opcional)'), 'kq-15');
    await fireEvent.press(screen.getByRole('button', { name: 'Consultar trayectorias' }));
    expect(screen.getByText('La placa debe tener formato colombiano: ABC123 (carro) o ABC12D (moto).')).toBeTruthy();
    expect(fetch.mock.calls.some(([input]) => String(input).includes('/api/v1/queries?'))).toBe(false);

    await fireEvent.changeText(screen.getByLabelText('Placa (opcional)'), 'kqv-159');
    await fireEvent.press(screen.getByRole('button', { name: 'Consultar trayectorias' }));
    await waitFor(() => expect(screen.getByText(/^1 ruta estimada/)).toBeTruthy());
    const queryCall = fetch.mock.calls.find(([input]) => String(input).includes('/api/v1/queries?'));
    expect(new URL(String(queryCall?.[0])).searchParams.get('plate')).toBe('KQV159');

    await fireEvent.press(screen.getByRole('button', { name: /^Ruta estimada 1,/ }));
    const thumb = await screen.findByRole('imagebutton', { name: /Ampliar recorte · 1\. Portería Alondra/ });
    expect(screen.getByText('Sin recorte')).toBeTruthy();
    // Only the step with a recorte asks for one, with the session token.
    expect(screen.queryByTestId('recorte-det-2')).toBeNull();
    const image = screen.getByTestId('recorte-det-1');
    expect(image.props.source).toEqual({
      uri: expect.stringMatching(/\/api\/v1\/detections\/det-1\/thumbnail$/),
      headers: { Authorization: 'Bearer session-token', Accept: 'image/jpeg' },
    });
    await fireEvent(image, 'load', { nativeEvent: { source: { width: 224, height: 168 } } });
    await fireEvent.press(thumb);
    expect(await screen.findByLabelText(/Recorte ampliado · 1\. Portería Alondra .* · KQV159/)).toBeTruthy();
  });

  it('permite consultar el dataset en demo sin red y conserva avisos visibles', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch');
    const screen = await render(<SessionProvider><TestApp /></SessionProvider>);
    await fireEvent.press(screen.getByRole('button', { name: 'Explorar demo' }));
    await waitFor(() => expect(screen.getByText('4 Cámaras Registradas')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: /Query, tab/ }));
    expect(screen.getByText('DEMOSTRACIÓN')).toBeTruthy();
    expect(screen.getByText(/Trayectorias estimadas/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Consultar trayectorias' }));
    await waitFor(() => expect(screen.getByText(/^1 ruta estimada/)).toBeTruthy());
    expect(screen.getByText('DEMOSTRACIÓN')).toBeTruthy();
    expect(screen.getByText(/Trayectorias estimadas/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /Results, tab/ }));
    // The detail stays folded until the route is chosen.
    expect(screen.queryByText(/Explicación:/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: /^Ruta estimada 1,/ }));
    expect(screen.getAllByText(/Automóvil\s*·\s*blanco/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Explicación: detección 35% · tiempo 40% · apariencia 15% · vía 10%/)).toBeTruthy();
    expect(screen.getAllByText(/^\d+\. (Automóvil|Motocicleta)/)).toHaveLength(7);
    // The detail opens in a window that its close button (or back, or a tap outside) dismisses.
    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByText(/Explicación:/)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
