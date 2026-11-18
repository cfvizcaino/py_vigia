import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import { useMemo } from 'react';
import { Text, View } from 'react-native';

import type { Device } from '../types/models';
import { colors } from '../theme/colors';
import { fonts, type } from '../theme/fonts';

// Estilo oscuro: en el Figma el mapa va sobre un rectángulo #090119 de radio 24.
export const mapStyle = 'https://tiles.openfreemap.org/styles/dark';

interface CameraMapProps {
  devices: Device[];
  height: number;
  /** Rótulo de la esquina («Barranquilla, ATL / Colombia» en el Figma). */
  caption?: { title: string; subtitle: string } | null;
  center?: [number, number] | undefined;
  point?: [number, number] | undefined;
  onSelectPoint?: (point: [number, number]) => void;
}

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
  const initialCenter = center ?? (devices[0] ? [devices[0].lng, devices[0].lat] as [number, number] : [-74.8172, 11.0131]);

  return (
    <View style={{ height, overflow: 'hidden', borderRadius: 24, backgroundColor: colors.ink }}>
      <Map
        mapStyle={mapStyle}
        style={{ flex: 1 }}
        attribution
        logo
        onLongPress={(event) => onSelectPoint?.(event.nativeEvent.lngLat)}
      >
        <Camera key={initialCenter.join(',')} initialViewState={{ center: initialCenter, zoom: 12 }} />
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
      </Map>
      {caption ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 28, bottom: 20 }}>
          <Text style={type(fonts.poppins, 15)}>{caption.title}</Text>
          <Text style={[type(fonts.regular, 12), { color: '#d0d0d0' }]}>{caption.subtitle}</Text>
        </View>
      ) : null}
    </View>
  );
}
