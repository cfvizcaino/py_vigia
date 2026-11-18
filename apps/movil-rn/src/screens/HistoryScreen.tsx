import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '../components/Icon';
import { DemoBadge, EmptyState, Glass, Screen, SearchPill, vehicleTypeName } from '../components/ui';
import { colorNamesEs } from '../edge/colors';
import { useSession } from '../state/session';
import { gradients } from '../theme/colors';
import { fonts, type } from '../theme/fonts';
import { bogotaDateTime, parseApiDate } from '../time/bogota';
import type { QueryResult } from '../types/models';
import type { TabParamList } from '../types/navigation';

type Props = BottomTabScreenProps<TabParamList, 'History'>;

/** «Historial» del Figma (2226:1695 con consultas, 2254:2499 vacío). */
export function HistoryScreen({ navigation }: Props) {
  const { history, isDemo, openResult, activeResult } = useSession();
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return history;
    return history.filter((result) => describe(result).search.includes(term));
  }, [history, query]);

  return (
    <Screen tabs title={'Registros\nde búsqueda'} right={isDemo ? <DemoBadge /> : null}>
      <SearchPill value={query} onChangeText={setQuery} placeholder="Buscar en consultas..." />
      <Glass style={styles.panel}>
        <Text style={type(fonts.regular, 15, 18)}>Historial de consultas</Text>
        {!history.length ? (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <EmptyState icon="historyLarge" title="Historial vacío" description="Las consultas de esta sesión aparecerán aquí" />
          </View>
        ) : (
          <View style={styles.grid}>
            {visible.map((result) => (
              <HistoryTile
                key={String(result.query.id)}
                result={result}
                selected={activeResult?.query.id === result.query.id}
                onPress={() => {
                  openResult(result);
                  navigation.navigate('Results');
                }}
              />
            ))}
          </View>
        )}
      </Glass>
    </Screen>
  );
}

function describe(result: QueryResult) {
  const q = result.query;
  const vehicle = vehicleTypeName(q.vehicle_type ?? 'car');
  const color = q.color ? (colorNamesEs[q.color] ?? q.color) : 'Cualquier color';
  const camera = result.nearby_devices[0]?.name ?? `${q.lat.toFixed(3)}, ${q.lng.toFixed(3)}`;
  const from = bogotaDateTime(parseApiDate(q.time_from));
  const to = bogotaDateTime(parseApiDate(q.time_to)).slice(11);
  const [y, m, d] = from.slice(0, 10).split('-');
  const when = `${d}/${m}/${y?.slice(2)}, ${from.slice(11)} - ${to}`;
  return { vehicle, color: color.charAt(0).toUpperCase() + color.slice(1), camera, when, search: `${vehicle} ${color} ${camera} ${when}`.toLowerCase() };
}

function HistoryTile({ result, selected, onPress }: { result: QueryResult; selected: boolean; onPress: () => void }) {
  const info = describe(result);
  const moto = result.query.vehicle_type === 'motorcycle';
  const content = (
    <>
      <Icon name={moto ? 'motorcycleLarge' : 'car'} size={moto ? 32 : 24} />
      <Text style={[type(fonts.regular, 16, 19.2), styles.center, { marginTop: 4 }]}>{info.vehicle}</Text>
      <Text style={[type(fonts.regular, 9, 10.8), styles.center]}>{info.color} | {result.routes.length} rutas</Text>
      <Text style={[type(fonts.light, 10, 12), styles.center, { marginTop: 6 }]} numberOfLines={3}>{info.camera}{'\n'}{info.when}</Text>
    </>
  );
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${info.vehicle} ${info.color}, ${info.when}`} onPress={onPress} style={styles.tileBox}>
      {selected ? (
        <LinearGradient colors={gradients.tileOn} locations={[0.03, 0.67]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.tile, styles.tileOn]}>{content}</LinearGradient>
      ) : (
        <Glass variant="tile" radius={24} style={styles.tile}>{content}</Glass>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { paddingTop: 17, paddingHorizontal: 21, paddingBottom: 21, minHeight: 566, gap: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 21 },
  tileBox: { width: '47.5%' },
  tile: { aspectRatio: 155 / 154, borderRadius: 24, alignItems: 'center', justifyContent: 'center', padding: 10, gap: 2 },
  tileOn: { elevation: 4, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 4 } },
  center: { textAlign: 'center' },
});
