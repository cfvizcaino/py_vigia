import { Camera, GeoJSONSource, Layer, Map as MapView } from '@maplibre/maplibre-react-native';
import { useMemo } from 'react';
import { Text, View } from 'react-native';

import type { CandidateRoute, NearbyDevice } from '../types/models';
import { colors } from '../theme/colors';

const mapStyle = 'https://tiles.openfreemap.org/styles/liberty';

export function RouteMap({ route, devices }: { route: CandidateRoute; devices: NearbyDevice[] }) {
  const resolved = useMemo(() => resolveRouteCoordinates(route, devices), [route, devices]);
  if (!resolved.coordinates.length) {
    return <Text style={{ color: colors.subtle, lineHeight: 19 }}>Geometría vial no disponible para esta ruta; se conserva el orden de cámaras como referencia.</Text>;
  }
  const [first] = resolved.coordinates;
  if (!first) return null;
  const center: [number, number] = [first[0], first[1]];
  return (
    <View>
      <View style={{ height: 190, overflow: 'hidden', borderRadius: 8, backgroundColor: colors.surface }}>
        <MapView mapStyle={mapStyle} style={{ flex: 1 }} attribution logo>
          <Camera initialViewState={{ center, zoom: 13 }} />
          <GeoJSONSource id={`route-${route.id}`} data={resolved.featureCollection}>
            <Layer
              id={`route-line-${route.id}`}
              type="line"
              filter={['==', ['geometry-type'], 'LineString']}
              paint={{ 'line-color': colors.accent, 'line-width': 5, 'line-opacity': 0.9 }}
            />
            <Layer
              id={`route-points-${route.id}`}
              type="circle"
              filter={['==', ['geometry-type'], 'Point']}
              paint={{ 'circle-color': '#F4B942', 'circle-radius': 7, 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2 }}
            />
          </GeoJSONSource>
        </MapView>
      </View>
      {resolved.isFallback ? <Text style={{ color: colors.warning, fontSize: 12, marginTop: 6 }}>Visualización aproximada entre cámaras; no es geometría vial calculada.</Text> : null}
    </View>
  );
}

function resolveRouteCoordinates(route: CandidateRoute, devices: NearbyDevice[]): {
  coordinates: [number, number][];
  isFallback: boolean;
  featureCollection: {
    type: 'FeatureCollection';
    features: {
      type: 'Feature';
      properties: { kind: 'route' | 'camera' };
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
  const cameraCoordinates = route.camera_ids.flatMap((cameraId): [number, number][] => {
    const device = byId.get(cameraId);
    const coordinate = device ? parseCoordinate(device.lng, device.lat) : null;
    return coordinate ? [coordinate] : [];
  });
  const isFallback = roadCoordinates.length < 2;
  const coordinates = isFallback ? cameraCoordinates : roadCoordinates;
  const features: {
    type: 'Feature';
    properties: { kind: 'route' | 'camera' };
    geometry: { type: 'LineString'; coordinates: [number, number][] } | { type: 'Point'; coordinates: [number, number] };
  }[] = [];
  if (coordinates.length >= 2) {
    features.push({
      type: 'Feature',
      properties: { kind: 'route' },
      geometry: { type: 'LineString', coordinates },
    });
  }
  for (const coordinate of cameraCoordinates) {
    features.push({
      type: 'Feature',
      properties: { kind: 'camera' },
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
