import { render } from '@testing-library/react-native';
import { describe, expect, it, jest } from '@jest/globals';

import type { CandidateRoute, NearbyDevice } from '../types/models';
import { RouteMap, resolveRouteCoordinates } from './RouteMap';

// Imita a MapLibre: una fuente o capa montada no puede cambiar de id (useFrozenId).
jest.mock('@maplibre/maplibre-react-native', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const Frozen = ({ id, children }: import('react').PropsWithChildren<{ id?: string }>) => {
    const first = React.useRef(id);
    if (first.current !== id) throw new Error('`id` cannot be changed');
    return React.createElement(View, null, children);
  };
  const Plain = ({ children }: import('react').PropsWithChildren) => React.createElement(View, null, children);
  return { Map: Plain, Camera: Plain, GeoJSONSource: Frozen, Layer: Frozen };
});

const devices: NearbyDevice[] = [
  { id: 'd1', external_id: 'CEL-NICO', name: 'Nico', lat: 11.01, lng: -74.81, distance_m: 0 },
  { id: 'd2', external_id: 'CEL-VENECO', name: 'Veneco', lat: 11.02, lng: -74.82, distance_m: 900 },
];

function route(id: string): CandidateRoute {
  return {
    id, rank: 1, confidence: 0.9, has_distant_gaps: false, camera_ids: ['CEL-NICO', 'CEL-VENECO'],
    vehicle_type: 'car', detections: [], explanation: {}, road_geometry: null,
  };
}

describe('RouteMap', () => {
  it('pasa de una ruta a otra sin cambiar el id de la fuente montada', async () => {
    const screen = await render(<RouteMap route={route('r1')} devices={devices} />);
    await expect(screen.rerender(<RouteMap route={route('r2')} devices={devices} />)).resolves.toBeUndefined();
  });

  it('etiqueta cada nodo con su orden y su nombre; uno repetido junta sus posiciones', () => {
    const looping = { ...route('r3'), camera_ids: ['CEL-NICO', 'CEL-VENECO', 'CEL-NICO'] };
    const labels = resolveRouteCoordinates(looping, devices).featureCollection.features
      .filter((feature) => feature.properties.kind === 'camera')
      .map((feature) => feature.properties.label);
    expect(labels).toEqual(['1 · 3. Nico', '2. Veneco']);
  });
});
