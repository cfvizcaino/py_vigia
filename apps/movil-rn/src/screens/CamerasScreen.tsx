import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CameraMap } from '../components/CameraMap';
import { Icon } from '../components/Icon';
import { PulseDot, Reveal } from '../components/motion';
import { DemoBadge, Glass, Screen, SearchPill } from '../components/ui';
import { activityLabel, type ActivityTone } from '../state/activity';
import { useSession } from '../state/session';
import { colors } from '../theme/colors';
import { fonts, type } from '../theme/fonts';
import type { Device } from '../types/models';
import type { RootStackParamList } from '../types/navigation';

/** «Camaras W04» del Figma (2173:75 con cámaras, 2254:2450 sin cámaras). */
export function CamerasScreen() {
  const { devices, isDemo, user } = useSession();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const isAdmin = user?.role === 'admin' && !isDemo;
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return devices;
    return devices.filter((device) => `${device.external_id} ${device.name}`.toLowerCase().includes(term));
  }, [devices, query]);

  return (
    <Screen
      tabs
      title={'Dispositivos\nde la red.'}
      right={isAdmin ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Agregar edge" hitSlop={12} onPress={() => navigation.navigate('AddEdge')} style={styles.add}>
          <Text style={type(fonts.regular, 14)}>+</Text>
          <Icon name="addCamera" size={18} />
        </Pressable>
      ) : isDemo ? <DemoBadge /> : null}
    >
      <SearchPill value={query} onChangeText={setQuery} placeholder="Buscar nombre o identificador..." />
      <Glass style={styles.panel}>
        <Text style={type(fonts.regular, 15, 18)}>Red de Cámaras</Text>
        <Text style={[type(fonts.light, 9, 11.7, 0), { marginTop: 2 }]}>{devices.length} Cámaras Registradas</Text>
        {devices.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="videocamOff" size={41} />
            <Text style={[type(fonts.regular, 15, 18), { width: 150 }]}>El servidor no tiene cámaras registradas</Text>
          </View>
        ) : (
          <ScrollView nestedScrollEnabled style={{ maxHeight: 214, marginTop: 18 }} contentContainerStyle={{ gap: 9 }}>
            {visible.map((device, index) => (
              <Reveal key={device.id} index={index}>
                <CameraRow device={device} onPress={() => navigation.navigate('CameraDetail', { deviceId: device.id })} />
              </Reveal>
            ))}
            {!visible.length ? <Text style={[type(fonts.light, 13), { opacity: 0.7, paddingVertical: 12 }]}>Ninguna cámara coincide con «{query}».</Text> : null}
          </ScrollView>
        )}
      </Glass>
      <CameraMap devices={devices} height={259} />
    </Screen>
  );
}

function CameraRow({ device, onPress }: { device: Device; onPress: () => void }) {
  const { label, tone } = activityLabel(device);
  const kind = device.kind === 'physical' ? 'Cámara física' : device.kind === 'simulated' ? 'Simulada' : device.kind;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Abrir ${device.external_id}`} onPress={onPress}>
      <Glass variant="tile" radius={24} style={styles.row}>
        <Icon name="webcam" size={24} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={type(fonts.semibold, 15, 18)}>{device.external_id}</Text>
          <Text numberOfLines={1} style={type(fonts.light, 13, 15.6)}>{device.name} | {kind}</Text>
        </View>
        <View style={styles.status}>
          <PulseDot color={toneColor[tone]} size={6} live={tone === 'ok'} />
          <Text style={[type(fonts.regular, 9, 10.8), { opacity: tone === 'off' ? 0.6 : 1 }]}>{label}</Text>
        </View>
      </Glass>
    </Pressable>
  );
}

export function StatusTag({ status }: { status: string }) {
  const online = status === 'online';
  return <Text style={[type(fonts.light, 12), { opacity: online ? 1 : 0.7 }]}>{online ? 'En Línea' : 'Sin conexión'}</Text>;
}

const toneColor: Record<ActivityTone, string> = { ok: colors.success, warn: colors.warning, off: 'rgba(255,255,255,0.45)' };

const styles = StyleSheet.create({
  add: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  panel: { paddingTop: 17, paddingHorizontal: 21, paddingBottom: 21, minHeight: 298 },
  row: { height: 57, flexDirection: 'row', alignItems: 'center', gap: 16, paddingLeft: 38, paddingRight: 25 },
  status: { position: 'absolute', top: 5, right: 25, flexDirection: 'row', alignItems: 'center', gap: 4 },
  empty: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, minHeight: 200 },
});
