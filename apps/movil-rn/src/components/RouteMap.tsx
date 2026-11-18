import { Camera, GeoJSONSource, Layer, Map as MapView } from '@maplibre/maplibre-react-native';
import type { CameraRef, LngLatBounds } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import type { CandidateRoute, NearbyDevice } from '../types/models';
import { colors } from '../theme/colors';
import { mapStyle } from './CameraMap';


const FIT_PADDING = { top: 44, right: 44, bottom: 44, left: 44 };

/**
 * Mapa de la ruta elegida. Es **un solo mapa** que se queda montado: al cambiar de ruta
 * cambian los datos de la línea y la cámara se desliza hasta ella. Antes se montaba un mapa
 * nuevo por ruta (key = id) y, al pasar rápido entre rutas, MapLibre se cerraba con un
 * puntero nulo en su código nativo al destruir un mapa que aún estaba dibujando.
 */
export function RouteMap({ route, devices, height = 266 }: { route: CandidateRoute; devices: NearbyDevice[]; height?: number }) {
  const resolved = useMemo(() => resolveRouteCoordinates(route, devices), [route, devices]);
  const cameraRef = useRef<CameraRef>(null);
  // Without route geometry, frame the cameras of the query so the map never jumps to nowhere.
  const frame = useMemo(() => boundsOf(resolved.coordinates.length ? resolved.coordinates
    : devices.flatMap((device): [number, number][] => {
      const coordinate = parseCoordinate(device.lng, device.lat);
      return coordinate ? [coordinate] : [];
    })), [resolved.coordinates, devices]);
  const [initialFrame] = useState(frame);
  const routeKey = String(route.id);
  const firstRoute = useRef(routeKey);
  useEffect(() => {
    if (!frame || routeKey === firstRoute.current) return;
    firstRoute.current = '';
    cameraRef.current?.fitBounds(frame, { padding: FIT_PADDING, duration: 650, easing: 'ease' });
  }, [frame, routeKey]);

  if (!initialFrame) {
    return <Text style={{ color: colors.subtle, lineHeight: 19 }}>Geometría vial no disponible para esta ruta; se conserva el orden de cámaras como referencia.</Text>;
  }
  return (
    <View>
      <View style={{ height, overflow: 'hidden', borderRadius: 24, backgroundColor: colors.ink }}>
        {/* Ids fijos: MapLibre no deja cambiar el id de una fuente o capa montada. */}
        <MapView mapStyle={mapStyle} style={{ flex: 1 }} attribution logo>
          <Camera ref={cameraRef} initialViewState={{ bounds: initialFrame, padding: FIT_PADDING }} />
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
          </GeoJSONSource>
        </MapView>
      </View>
      {!resolved.coordinates.length ? <Text style={{ color: colors.warning, fontSize: 12, marginTop: 6 }}>Esta ruta no trae geometría vial; el mapa muestra las cámaras de la consulta.</Text>
        : resolved.isFallback ? <Text style={{ color: colors.warning, fontSize: 12, marginTop: 6 }}>Visualización aproximada entre cámaras; no es geometría vial calculada.</Text> : null}
    </View>
  );
}

/** [west, south, east, north]; a single point gets a small box so the zoom stays sensible. */
export function boundsOf(points: [number, number][]): LngLatBounds | null {
  if (!points.length) return null;
  let [west, south] = points[0]!;
  let [east, north] = points[0]!;
  for (const [lng, lat] of points) {
    west = Math.min(west, lng); east = Math.max(east, lng);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  const pad = 0.0025;
  if (east - west < pad) { west -= pad; east += pad; }
  if (north - south < pad) { south -= pad; north += pad; }
  return [west, south, east, north];
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
