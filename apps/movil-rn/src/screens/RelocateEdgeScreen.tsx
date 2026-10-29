import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { ApiError } from '../api/client';
import { CameraMap } from '../components/CameraMap';
import { ErrorMessage, PrimaryButton, Screen } from '../components/ui';
import { useSession } from '../state/session';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'RelocateEdge'>;

/** Admin (F04): move an existing camera with GPS or the map. */
export function RelocateEdgeScreen({ navigation, route }: Props) {
  const { devices, relocateEdge } = useSession();
  const device = devices.find((item) => item.id === route.params.deviceId);
  const [point, setPoint] = useState<[number, number] | null>(device ? [device.lng, device.lat] : null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (device) navigation.setOptions({ title: `Ubicación de ${device.external_id}` });
  }, [device, navigation]);

  if (!device || !point) {
    return (
      <Screen>
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
    <Screen>
      <Text style={{ color: colors.muted, lineHeight: 20 }}>
        Párate donde está la cámara y usa el GPS, o mantén pulsado el punto exacto en el mapa.
      </Text>
      <CameraMap devices={devices} height={320} center={point} point={point} onSelectPoint={setPoint} />
      <Text style={{ color: colors.subtle, fontSize: 12 }}>{point[1].toFixed(5)}, {point[0].toFixed(5)}</Text>
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      <PrimaryButton title="Guardar ubicación" loading={saving} onPress={() => void save()} />
      <Text style={{ color: colors.subtle, fontSize: 12 }}>
        Con más de una cámara, después hay que resincronizar las rutas viales (OSRM).
      </Text>
    </Screen>
  );
}
