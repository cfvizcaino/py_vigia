import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Card, DemoBadge, EmptyState, PrimaryButton, Screen } from '../components/ui';
import { CameraMap } from '../components/CameraMap';
import { StatusTag } from './CameraDetailScreen';
import { useSession } from '../state/session';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../types/navigation';

export function CamerasScreen() {
  const { devices, isDemo, user } = useSession();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const isAdmin = user?.role === 'admin' && !isDemo;
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
      {isAdmin ? <PrimaryButton title="Agregar edge" onPress={() => navigation.navigate('AddEdge')} /> : null}
      {devices.map((device) => (
        <Pressable
          key={device.id}
          accessibilityRole="button"
          accessibilityLabel={`Abrir ${device.external_id}`}
          onPress={() => navigation.navigate('CameraDetail', { deviceId: device.id })}
        >
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 42, height: 42, borderRadius: 6, backgroundColor: '#26352D', alignItems: 'center', justifyContent: 'center' }}>
                <MaterialIcons name="videocam" size={22} color="#8FE1C4" />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>{device.external_id}</Text>
                <Text style={{ color: colors.muted }}>{device.name} · {device.lat.toFixed(4)}, {device.lng.toFixed(4)}</Text>
              </View>
              <StatusTag status={device.status} />
            </View>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
