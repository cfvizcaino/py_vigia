import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import { useMemo } from 'react';
import { View } from 'react-native';

import type { Device } from '../types/models';
import { colors } from '../theme/colors';

const mapStyle = 'https://tiles.openfreemap.org/styles/liberty';

interface CameraMapProps {
  devices: Device[];
  height: number;
  center?: [number, number] | undefined;
  point?: [number, number] | undefined;
  onSelectPoint?: (point: [number, number]) => void;
}

export function CameraMap({ devices, height, center, point, onSelectPoint }: CameraMapProps) {
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
  const initialCenter = center ?? (devices[0] ? [devices[0].lng, devices[0].lat] as [number, number] : [-74.8172, 11.0131]);

  return (
    <View style={{ height, overflow: 'hidden', borderRadius: 8, backgroundColor: colors.surface }}>
      <Map
        mapStyle={mapStyle}
        style={{ flex: 1 }}
        attribution
        logo
        onLongPress={(event) => onSelectPoint?.(event.nativeEvent.lngLat)}
      >
        <Camera initialViewState={{ center: initialCenter, zoom: 12 }} />
        <GeoJSONSource id="vigia-cameras" data={cameraData}>
          <Layer
            id="vigia-camera-dots"
            type="circle"
            paint={{ 'circle-color': colors.accent, 'circle-radius': 8, 'circle-stroke-color': '#102019', 'circle-stroke-width': 2 }}
          />
          <Layer
            id="vigia-camera-labels"
            type="symbol"
            layout={{ 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, 1.4], 'text-anchor': 'top' }}
            paint={{ 'text-color': '#14221B', 'text-halo-color': '#F7F9F8', 'text-halo-width': 1 }}
          />
        </GeoJSONSource>
        <GeoJSONSource id="vigia-selected-point" data={pointData}>
          <Layer
            id="vigia-selected-point-dot"
            type="circle"
            paint={{ 'circle-color': '#F4B942', 'circle-radius': 9, 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2 }}
          />
        </GeoJSONSource>
      </Map>
    </View>
  );
}
