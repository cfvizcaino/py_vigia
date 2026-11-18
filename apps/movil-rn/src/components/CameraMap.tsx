import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { useMemo } from 'react';

import type { Device } from '../types/models';
import { colors } from '../theme/colors';
import { MapStage, boundsOf } from './MapStage';

export { mapStyle } from './MapStage';

interface CameraMapProps {
  devices: Device[];
  height: number;
  /** Rótulo de la esquina («Barranquilla, ATL / Colombia» en el Figma). */
  caption?: { title: string; subtitle: string } | null;
  center?: [number, number] | undefined;
  point?: [number, number] | undefined;
  onSelectPoint?: (point: [number, number]) => void;
}

/**
 * Cámaras de la red (y el punto elegido, si lo hay). Arranca mostrando todas; al elegir un
 * punto la vista se desliza hasta él sin volver a crear el mapa.
 */
export function CameraMap({ devices, height, center, point, onSelectPoint, caption = { title: 'Barranquilla, ATL', subtitle: 'Colombia' } }: CameraMapProps) {
  const cameraData = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: devices.map((device) => ({
      type: 'Feature' as const,
      id: device.id,
      properties: { label: device.external_id },
      geometry: { type: 'Point' as const, coordinates: [device.lng, device.lat] },
    })),
  }), [devices]);
  const pointData = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: point ? [{
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'Point' as const, coordinates: point },
    }] : [],
  }), [point]);
  const frame = useMemo(() => boundsOf([
    ...devices.map((device): [number, number] => [device.lng, device.lat]),
    ...(center ? [center] : []),
  ]), [devices, center]);
  const frameKey = useMemo(() => devices.map((device) => device.id).sort().join(','), [devices]);

  return (
    <MapStage
      height={height}
      frame={frame}
      frameKey={frameKey}
      focus={point ?? null}
      caption={caption}
      onPick={onSelectPoint}
      fullscreenTitle={onSelectPoint ? 'Elige el punto' : 'Cámaras de la red'}
      fullscreenHint={onSelectPoint ? 'Toca el mapa para elegir el punto. Arrastra para moverte y pellizca para acercarte.' : 'Arrastra para moverte y pellizca para acercarte.'}
    >
      <GeoJSONSource id="vigia-cameras" data={cameraData}>
        <Layer
          id="vigia-camera-dots"
          type="circle"
          paint={{ 'circle-color': colors.accent, 'circle-radius': 8, 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2 }}
        />
        <Layer
          id="vigia-camera-labels"
          type="symbol"
          layout={{ 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.4], 'text-anchor': 'top' }}
          paint={{ 'text-color': '#FFFFFF', 'text-halo-color': '#090119', 'text-halo-width': 1 }}
        />
      </GeoJSONSource>
      <GeoJSONSource id="vigia-selected-point" data={pointData}>
        <Layer
          id="vigia-selected-point-dot"
          type="circle"
          paint={{ 'circle-color': '#c4a8ff', 'circle-radius': 9, 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2 }}
        />
      </GeoJSONSource>
    </MapStage>
  );
}
