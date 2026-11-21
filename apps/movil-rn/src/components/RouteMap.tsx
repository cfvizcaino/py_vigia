import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { useMemo } from 'react';
import { Text, View } from 'react-native';

import type { CandidateRoute, NearbyDevice } from '../types/models';
import { colors } from '../theme/colors';
import { MapStage, boundsOf } from './MapStage';


/**
 * Mapa de la ruta enfocada. Es un solo mapa que se queda montado: al cambiar de ruta cambian
 * los datos de la línea y la vista se desliza hasta ella. (Antes se montaba un mapa nuevo por
 * ruta y, al pasar rápido, MapLibre se cerraba en su código nativo.)
 */
export function RouteMap({ route, devices, height = 266 }: { route: CandidateRoute; devices: NearbyDevice[]; height?: number }) {
  const resolved = useMemo(() => resolveRouteCoordinates(route, devices), [route, devices]);
  // Without route geometry, frame the cameras of the query so the map never jumps to nowhere.
  const frame = useMemo(() => boundsOf(resolved.coordinates.length ? resolved.coordinates
    : devices.flatMap((device): [number, number][] => {
      const coordinate = parseCoordinate(device.lng, device.lat);
      return coordinate ? [coordinate] : [];
    })), [resolved.coordinates, devices]);

  if (!frame) {
    return <Text style={{ color: colors.subtle, lineHeight: 19 }}>Geometría vial no disponible para esta ruta; se conserva el orden de cámaras como referencia.</Text>;
  }
  return (
    <View>
      <MapStage height={height} frame={frame} frameKey={String(route.id)} fullscreenTitle="Ruta en el mapa" fullscreenHint="Arrastra para moverte y pellizca para acercarte.">
        {/* Ids fijos: MapLibre no deja cambiar el id de una fuente o capa montada. */}
        <GeoJSONSource id="vigia-route" data={resolved.featureCollection}>
          <Layer
            id="vigia-route-line"
            type="line"
            filter={['==', ['geometry-type'], 'LineString']}
            paint={{ 'line-color': colors.accent, 'line-width': 5, 'line-opacity': 0.9 }}
          />
          <Layer
            id="vigia-route-points"
            type="circle"
            filter={['==', ['geometry-type'], 'Point']}
            paint={{ 'circle-color': '#c4a8ff', 'circle-radius': 7, 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2 }}
          />
          {/* Each node says its order in the route and its name, as in the web console. */}
          <Layer
            id="vigia-route-labels"
            type="symbol"
            filter={['==', ['geometry-type'], 'Point']}
            layout={{
              'text-field': ['get', 'label'],
              'text-font': ['Noto Sans Regular'],
              'text-size': 11,
              'text-offset': [0, 1.3],
              'text-anchor': 'top',
              'text-allow-overlap': true,
              'text-max-width': 9,
            }}
            paint={{ 'text-color': '#FFFFFF', 'text-halo-color': '#090119', 'text-halo-width': 1.2 }}
          />
        </GeoJSONSource>
      </MapStage>
      {!resolved.coordinates.length ? <Text style={{ color: colors.warning, fontSize: 12, marginTop: 6 }}>Esta ruta no trae geometría vial; el mapa muestra las cámaras de la consulta.</Text>
        : resolved.isFallback ? <Text style={{ color: colors.warning, fontSize: 12, marginTop: 6 }}>Visualización aproximada entre cámaras; no es geometría vial calculada.</Text> : null}
    </View>
  );
}

export function resolveRouteCoordinates(route: CandidateRoute, devices: NearbyDevice[]): {
  coordinates: [number, number][];
  isFallback: boolean;
  featureCollection: {
    type: 'FeatureCollection';
    features: {
      type: 'Feature';
      properties: { kind: 'route' | 'camera'; label?: string };
      geometry: { type: 'LineString'; coordinates: [number, number][] } | { type: 'Point'; coordinates: [number, number] };
    }[];
  };
} {
  const geometryPoints = route.road_geometry?.points;
  const roadCoordinates = Array.isArray(geometryPoints)
    ? geometryPoints.flatMap((point): [number, number][] => {
      if (!point || typeof point !== 'object') return [];
      const { lng, lat } = point as { lng?: unknown; lat?: unknown };
      const coordinate = parseCoordinate(lng, lat);
      return coordinate ? [coordinate] : [];
    })
    : [];
  const byId = new Map<string, NearbyDevice>();
  for (const device of devices) {
    byId.set(device.id, device);
    byId.set(device.external_id, device);
  }
  const cameras = route.camera_ids.flatMap((cameraId, index): { coordinate: [number, number]; order: number; name: string }[] => {
    const device = byId.get(cameraId);
    const coordinate = device ? parseCoordinate(device.lng, device.lat) : null;
    return coordinate ? [{ coordinate, order: index + 1, name: device?.name || cameraId }] : [];
  });
  const cameraCoordinates = cameras.map((camera) => camera.coordinate);
  const isFallback = roadCoordinates.length < 2;
  const coordinates = isFallback ? cameraCoordinates : roadCoordinates;
  const features: {
    type: 'Feature';
    properties: { kind: 'route' | 'camera'; label?: string };
    geometry: { type: 'LineString'; coordinates: [number, number][] } | { type: 'Point'; coordinates: [number, number] };
  }[] = [];
  if (coordinates.length >= 2) {
    features.push({
      type: 'Feature',
      properties: { kind: 'route' },
      geometry: { type: 'LineString', coordinates },
    });
  }
  // A node the route visits twice gets one label with both positions («1 · 3. Portería»).
  const labels = new Map<string, { coordinate: [number, number]; orders: number[]; name: string }>();
  for (const { coordinate, order, name } of cameras) {
    const key = coordinate.join(',');
    const entry = labels.get(key);
    if (entry) entry.orders.push(order);
    else labels.set(key, { coordinate, orders: [order], name });
  }
  for (const { coordinate, orders, name } of labels.values()) {
    features.push({
      type: 'Feature',
      properties: { kind: 'camera', label: `${orders.join(' · ')}. ${name}` },
      geometry: { type: 'Point', coordinates: coordinate },
    });
  }
  return {
    coordinates,
    isFallback,
    featureCollection: { type: 'FeatureCollection', features },
  };
}

function parseCoordinate(lng: unknown, lat: unknown): [number, number] | null {
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180
    || typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  return [lng, lat];
}
