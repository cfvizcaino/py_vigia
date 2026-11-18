import * as Location from 'expo-location';
import { useState } from 'react';
import { Text, View } from 'react-native';

import type { Device } from '../types/models';
import { colors } from '../theme/colors';
import { CameraMap } from './CameraMap';
import { ErrorMessage, PrimaryButton } from './ui';
import { fonts, type } from '../theme/fonts';

interface LocationPickerProps {
  devices: Device[];
  showGpsButton?: boolean;
  caption?: { title: string; subtitle: string } | null;
  point: [number, number] | undefined;
  height: number;
  onChange: (point: [number, number], accuracyM: number | null) => void;
}

export function LocationPicker({ devices, point, height, onChange, showGpsButton = true, caption = null }: LocationPickerProps) {
  const [locating, setLocating] = useState(false);
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getMyLocation = async () => {
    setLocating(true);
    setError(null);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!await Location.hasServicesEnabledAsync()) {
        throw new Error('Activa la ubicación del teléfono. También puedes elegir el punto en el mapa.');
      }
      let permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted && permission.canAskAgain) {
        permission = await Location.requestForegroundPermissionsAsync();
      }
      if (!permission.granted) {
        throw new Error(
          permission.canAskAgain
            ? 'Sin permiso de ubicación. Puedes elegir el punto en el mapa.'
            : 'Permiso de ubicación denegado permanentemente. Actívalo en Ajustes o elige el punto en el mapa.',
        );
      }
      const position = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('No se obtuvo la ubicación a tiempo. Elige el punto en el mapa.')), 20_000);
        }),
      ]);
      const nextPoint: [number, number] = [position.coords.longitude, position.coords.latitude];
      setAccuracyM(position.coords.accuracy);
      onChange(nextPoint, position.coords.accuracy);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se obtuvo la ubicación. Elige el punto en el mapa.');
    } finally {
      if (timeout) clearTimeout(timeout);
      setLocating(false);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      {showGpsButton ? (
        <PrimaryButton
          title={locating ? 'Obteniendo ubicación…' : 'Usar mi ubicación'}
          accessibilityLabel="Usar mi ubicación"
          icon="ms_my_location"
          disabled={locating}
          onPress={() => void getMyLocation()}
        />
      ) : null}
      <CameraMap
        caption={caption}
        devices={devices}
        height={height}
        center={point}
        point={point}
        onSelectPoint={(selected) => {
          setAccuracyM(null);
          setError(null);
          onChange(selected, null);
        }}
      />
      <Text style={[type(fonts.medium, 11.5, 15), { color: point ? colors.text : colors.warning }]}>
        {point
          ? `${point[1].toFixed(6)}, ${point[0].toFixed(6)}${accuracyM === null ? ' · elegida en el mapa' : ` · GPS ±${Math.round(accuracyM)} m`}`
          : 'Mantén pulsado el mapa, ábrelo en pantalla completa y tócalo, o usa tu ubicación.'}
      </Text>
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
    </View>
  );
}
