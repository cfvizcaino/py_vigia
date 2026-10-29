import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Device } from '../types/models';
import { colors } from '../theme/colors';
import { ErrorMessage } from './ui';

const mapStyle = 'https://tiles.openfreemap.org/styles/liberty';

interface CameraMapProps {
  devices: Device[];
  height: number;
  center?: [number, number] | undefined;
  point?: [number, number] | undefined;
  onSelectPoint?: (point: [number, number]) => void;
}

export function CameraMap({ devices, height, center, point, onSelectPoint }: CameraMapProps) {
  const [locationError, setLocationError] = useState<string | null>(null);
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

  const locate = async () => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setLocationError('Permite el acceso a la ubicación para usar el GPS.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLocationError(null);
      onSelectPoint?.([position.coords.longitude, position.coords.latitude]);
    } catch {
      setLocationError('No fue posible obtener la ubicación del dispositivo.');
    }
  };

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
      {onSelectPoint ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Usar mi ubicación actual"
          onPress={() => void locate()}
          style={{ position: 'absolute', right: 12, top: 12, backgroundColor: colors.surface, borderRadius: 8, padding: 10 }}
        >
          <Text style={{ color: colors.text, fontWeight: '700' }}>Usar mi ubicación</Text>
        </Pressable>
      ) : null}
      {locationError ? <View style={{ padding: 8 }}><ErrorMessage>{locationError}</ErrorMessage></View> : null}
    </View>
  );
}
