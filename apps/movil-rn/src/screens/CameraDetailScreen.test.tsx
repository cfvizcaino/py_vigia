import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';

import { ApiError } from '../api/client';
import { useSession } from '../state/session';
import type { Device } from '../types/models';
import { CameraDetailScreen } from './CameraDetailScreen';

jest.mock('../state/session', () => ({ useSession: jest.fn() }));

const device: Device = {
  id: 'device-1',
  external_id: 'CAM-01',
  name: 'Cámara de prueba',
  kind: 'physical',
  status: 'online',
  lat: 11,
  lng: -74,
  camera_model: null,
};

async function setup(
  role: 'admin' | 'operator' = 'admin',
  deleteImpl: () => Promise<void> = async () => undefined,
  isDemo = false,
) {
  const deleteDevice = jest.fn(async (_deviceId: string) => deleteImpl());
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  jest.mocked(useSession).mockReturnValue({
    devices: [device],
    user: { id: 'user-1', email: 'user@example.org', display_name: 'Usuario', role },
    isDemo,
    recentDetections: jest.fn(async () => []),
    listCredentials: jest.fn(async () => []),
    issueCredential: jest.fn(async () => { throw new Error('Not used'); }),
    revokeCredential: jest.fn(async () => undefined),
    deleteDevice,
  } as unknown as ReturnType<typeof useSession>);
  const screen = await render(
    <CameraDetailScreen
      navigation={navigation as never}
      route={{ params: { deviceId: device.id } } as never}
    />,
  );
  return { screen, navigation, deleteDevice };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('eliminación de nodos desde el detalle', () => {
  it('no muestra la acción de eliminar a un operador ni en modo demo', async () => {
    const { screen } = await setup('operator');
    expect(screen.queryByRole('button', { name: 'Eliminar nodo' })).toBeNull();
    await screen.unmount();
    const demo = await setup('admin', async () => undefined, true);
    expect(demo.screen.queryByRole('button', { name: 'Eliminar nodo' })).toBeNull();
  });

  it('permite cancelar la confirmación sin llamar a la API', async () => {
    const { screen, deleteDevice } = await setup();
    await fireEvent.press(screen.getByRole('button', { name: 'Eliminar nodo' }));

    expect(screen.getByText('¿Estás seguro de eliminar este nodo?')).toBeTruthy();
    expect(screen.getByText(/«Cámara de prueba» dejará de enviar datos/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
    expect(deleteDevice).not.toHaveBeenCalled();
  });

  it('al confirmar elimina el nodo y vuelve a la lista', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { screen, navigation, deleteDevice } = await setup();
    await fireEvent.press(screen.getByRole('button', { name: 'Eliminar nodo' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Eliminar' }));

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
    expect(deleteDevice).toHaveBeenCalledWith(device.id);
    expect(alert.mock.calls.length).toBe(1);
  });

  it('desactiva la acción mientras la eliminación está en curso', async () => {
    let finishDelete: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { finishDelete = resolve; });
    const { screen, navigation, deleteDevice } = await setup('admin', () => pending);
    await fireEvent.press(screen.getByRole('button', { name: 'Eliminar nodo' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Eliminar' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Eliminar nodo' }));

    expect(deleteDevice).toHaveBeenCalledTimes(1);
    finishDelete?.();
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
  });

  it.each([
    [new ApiError('Forbidden', 403), 'Solo un administrador puede eliminar nodos'],
    [new Error('Network failed'), 'No fue posible eliminar el nodo. Revisa la conexión e inténtalo de nuevo.'],
  ])('muestra el error de eliminación y permite reintentar', async (failure, message) => {
    const { screen, navigation } = await setup('admin', async () => { throw failure; });
    await fireEvent.press(screen.getByRole('button', { name: 'Eliminar nodo' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Eliminar' }));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Eliminar nodo' })).toBeTruthy();
  });

  it('avisa cuando el nodo ya no existe y regresa a la lista', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { screen, navigation } = await setup('admin', async () => { throw new ApiError('Not found', 404); });
    await fireEvent.press(screen.getByRole('button', { name: 'Eliminar nodo' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Eliminar' }));

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
    expect(alert.mock.calls.length).toBe(1);
  });
});
