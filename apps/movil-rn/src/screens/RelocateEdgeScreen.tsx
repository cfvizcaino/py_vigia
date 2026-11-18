import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Text } from 'react-native';

import { ApiError } from '../api/client';
import { LocationPicker } from '../components/LocationPicker';
import { Card, ErrorMessage, PrimaryButton, Screen } from '../components/ui';
import { useSession } from '../state/session';
import { fonts, type } from '../theme/fonts';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'RelocateEdge'>;

/** Admin (F04): move an existing camera with GPS or the map. */
export function RelocateEdgeScreen({ navigation, route }: Props) {
  const { devices, relocateEdge } = useSession();
  const device = devices.find((item) => item.id === route.params.deviceId);
  const [point, setPoint] = useState<[number, number] | null>(device ? [device.lng, device.lat] : null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!device || !point) {
    return (
      <Screen back>
        <ErrorMessage>La cámara ya no está en la lista.</ErrorMessage>
      </Screen>
    );
  }

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await relocateEdge(device.id, point[1], point[0]);
      navigation.goBack();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'No fue posible guardar la ubicación.');
      setSaving(false);
    }
  };

  return (
    <Screen back title={`Ubicación\nde ${device.external_id}`}>
      <Text style={[type(fonts.light, 11.5, 16, 0), { textAlign: 'center', opacity: 0.75 }]}>
        Párate donde está la cámara y usa el GPS, o mantén pulsado el punto exacto en el mapa.
      </Text>
      <Card title="Punto de la cámara" icon="ms_location_on">
        <LocationPicker devices={devices} height={250} point={point} onChange={(next) => setPoint(next)} />
      </Card>
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      <PrimaryButton title="Guardar ubicación" icon="ms_check" loading={saving} onPress={() => void save()} />
      <Text style={[type(fonts.light, 10.5, 14, 0), { textAlign: 'center', opacity: 0.6 }]}>
        Con más de una cámara, después hay que resincronizar las rutas viales (OSRM).
      </Text>
    </Screen>
  );
}
