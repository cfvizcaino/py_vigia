import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Card, DemoBadge, EmptyState, Screen } from '../components/ui';
import { CameraMap } from '../components/CameraMap';
import { AdminTools } from './AdminTools';
import { useSession } from '../state/session';
import { colors } from '../theme/colors';

export function CamerasScreen() {
  const { devices, isDemo, user } = useSession();
  const [showMap, setShowMap] = useState(true);

  return (
    <Screen>
      {isDemo ? <DemoBadge /> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>{devices.length} cámaras registradas</Text>
        <Pressable accessibilityRole="button" onPress={() => setShowMap((value) => !value)}>
          <Text style={{ color: colors.accent }}>{showMap ? 'Ver lista' : 'Ver mapa'}</Text>
        </Pressable>
      </View>
      {showMap ? (
        <Card title="Ubicación de cámaras">
          <CameraMap devices={devices} height={260} />
          <Text style={{ color: colors.subtle, fontSize: 12 }}>Mapa OpenStreetMap mediante MapLibre; mantén pulsado para elegir un punto.</Text>
        </Card>
      ) : null}
      {devices.length === 0 ? <EmptyState title="No hay cámaras" description="El servidor no tiene cámaras registradas." /> : null}
      {devices.map((device) => (
        <Card key={device.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={{ color: colors.accent, fontSize: 22 }}>◉</Text>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{device.external_id}</Text>
              <Text style={{ color: colors.muted }}>{device.name}</Text>
              <Text style={{ color: colors.subtle, fontSize: 12 }}>{device.lat.toFixed(4)}, {device.lng.toFixed(4)}</Text>
            </View>
            <Text style={{ color: device.status === 'online' ? colors.success : colors.warning }}>{device.status === 'online' ? 'En línea' : 'Sin conexión'}</Text>
          </View>
        </Card>
      ))}
      {user?.role === 'admin' && !isDemo ? <AdminTools /> : null}
    </Screen>
  );
}
