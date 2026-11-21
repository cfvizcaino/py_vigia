import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';

import { Icon } from '../components/Icon';
import { Reveal } from '../components/motion';
import { RouteCarousel } from '../components/RouteCarousel';
import { Sheet } from '../components/Sheet';
import { RouteMap } from '../components/RouteMap';
import { DemoBadge, ErrorMessage, Glass, PrimaryButton, SafetyBanner, Screen, SecondaryButton, formatDate, vehicleTypeName } from '../components/ui';
import { colorNamesEs } from '../edge/colors';
import { useSession } from '../state/session';
import { colors, gradients } from '../theme/colors';
import { fonts, type } from '../theme/fonts';
import type { CandidateRoute } from '../types/models';
import type { TabParamList } from '../types/navigation';

type Props = BottomTabScreenProps<TabParamList, 'Results'>;

/** «Resultados» del Figma: vacío (2254:2561), carrusel de rutas (2245:1502) y detalle de ruta (2245:1527). */
export function ResultsScreen({ navigation }: Props) {
  const { activeResult, devices, isDemo, user, exportResult, confirmDetection, clearDetectionConfirmation, error } = useSession();
  const isAdmin = !isDemo && user?.role === 'admin';
  // `focused`: la ruta del centro del carrusel (la que dibuja el mapa). `opened`: la que el
  // operador tocó; su detalle se abre en una ventana. Ambas se reinician con otra consulta.
  const [choice, setChoice] = useState<{ queryId: string; focused: number; opened: number | null }>({ queryId: '', focused: 0, opened: null });
  const queryId = String(activeResult?.query.id ?? '');
  const current = choice.queryId === queryId ? choice : { queryId, focused: 0, opened: null };
  const selected = current.focused;
  // Moving to another route folds the detail of the previous one.
  const focusRoute = (index: number) => setChoice({ queryId, focused: index, opened: null });
  const openRoute = (index: number | null) => setChoice({ queryId, focused: index ?? current.focused, opened: index });
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [confirmationBusyId, setConfirmationBusyId] = useState<string | null>(null);
  const routes = activeResult?.routes ?? [];
  const route = routes[Math.min(selected, routes.length - 1)];

  const header = (
    <View style={styles.heading}>
      <Icon name="lanes" size={40} />
      <View style={{ flex: 1 }}>
        <Text accessibilityRole="header" style={type(fonts.poppins, 24, 28.8)}>Rutas candidatas</Text>
        <Text style={type(fonts.light, 15, 18)}>
          {routes.length} {routes.length === 1 ? 'ruta estimada' : 'rutas estimadas'}
          {activeResult ? ` · ${activeResult.candidate_detection_count} ${activeResult.candidate_detection_count === 1 ? 'detección' : 'detecciones'}` : ''}
        </Text>
      </View>
    </View>
  );

  if (!activeResult || !route) {
    return (
      <Screen tabs header="Resultados" back={() => navigation.navigate('Query')} right={isDemo ? <DemoBadge /> : null} scroll={false}>
        {header}
        <View style={styles.empty}>
          <Icon name="searchList" size={65} color="#ffffff" />
          <Text style={[type(fonts.poppins, 16), { textAlign: 'center', marginTop: 10 }]}>Sin resultados</Text>
          <Text style={[type(fonts.light, 15, 18), { textAlign: 'center', width: 250 }]}>
            {activeResult ? 'La consulta no encontró trayectorias. Prueba con otro horario o un radio mayor.' : 'Realiza una consulta para revisar rutas y detecciones'}
          </Text>
        </View>
      </Screen>
    );
  }

  const exportAndShare = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const text = await exportResult(activeResult);
      await Share.share({ title: 'VIGÍA · Exportación auditada', message: text });
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : 'No fue posible exportar el resultado.');
    } finally {
      setExporting(false);
    }
  };

  const setConfirmation = async (detectionId: string, verdict: 'match' | 'reject' | null) => {
    setConfirmationBusyId(detectionId);
    setConfirmationError(null);
    try {
      if (verdict) await confirmDetection(String(activeResult.query.id), detectionId, verdict);
      else await clearDetectionConfirmation(String(activeResult.query.id), detectionId);
    } catch (reason) {
      setConfirmationError(reason instanceof Error ? reason.message : 'No fue posible guardar el veredicto.');
    } finally {
      setConfirmationBusyId(null);
    }
  };

  const index = routes.indexOf(route);
  const explanation = route.explanation as { weights?: Record<string, number> } | undefined;
  const detections = [...route.detections].sort((left, right) => left.sequence_order - right.sequence_order);
  const plate = isAdmin ? detections.find((detection) => detection.license_plate)?.license_plate : null;
  const cameras = Array.isArray(route.camera_ids) ? route.camera_ids : [];

  return (
    <Screen tabs header="Resultados" back={() => navigation.navigate('Query')} right={isDemo ? <DemoBadge /> : null}>
      {header}
      {activeResult.plate_unread ? (
        <Text style={[type(fonts.regular, 12, 16), styles.pad, { color: colors.warning }]}>
          Ninguna cámara leyó la placa buscada en esta ventana. Estas rutas son de vehículos con el mismo tipo y color sin placa leída: confírmalas con los recortes.
        </Text>
      ) : null}
      <RouteMap route={route} devices={activeResult.nearby_devices} height={298} />

      <RouteCarousel
        cards={routes.map((item, position) => ({
          key: String(item.id ?? position),
          title: `Ruta estimada ${String(item.rank ?? position + 1)}`,
          subtitle: routeLabel(item, isAdmin ? item.detections.find((detection) => detection.license_plate)?.license_plate : null),
          score: Math.round(Number(item.confidence ?? 0) * 100),
        }))}
        focused={index}
        selected={current.opened}
        onFocus={focusRoute}
        onSelect={openRoute}
      />

      <Text style={[type(fonts.light, 12, 16), { textAlign: 'center', opacity: 0.8 }]}>Desliza para comparar rutas y toca una para ver su detalle.</Text>

      <Sheet
        visible={current.opened === index}
        title={`Ruta estimada ${String(route.rank ?? index + 1)}`}
        subtitle={`${routeLabel(route, plate)} · ${Math.round(Number(route.confidence ?? 0) * 100)}/100`}
        onClose={() => openRoute(null)}
      >
        <LinearGradient colors={gradients.routeCard} locations={[0, 0.92]} style={styles.detail}>
          <View style={{ flexDirection: 'row', gap: 15, paddingHorizontal: 11 }}>
            <Icon name="routePinSmall" size={24} style={{ marginTop: 4 }} />
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={type(fonts.medium, 12, 15)}>Recorrido por cámaras</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                {cameras.length ? cameras.map((camera, step) => (
                  <View key={`${camera}-${step}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {step > 0 ? <Icon name="arrowForward" size={11} /> : null}
                    <Text style={type(fonts.regular, 11, 13.2)}>{camera}</Text>
                  </View>
                )) : <Text style={type(fonts.regular, 11, 13.2)}>Cámaras no disponibles</Text>}
              </View>
            </View>
          </View>
          <Text style={[type(fonts.light, 11, 14), styles.pad]}>Es un puntaje de ranking, no una probabilidad de identificación.</Text>
          {route.has_distant_gaps ? <Text style={[type(fonts.regular, 11, 14), styles.pad, { color: colors.warning }]}>Hay saltos distantes entre observaciones.</Text> : null}
          {explanation?.weights ? (
            <Text style={[type(fonts.light, 11, 14), styles.pad]}>
              Explicación: {Object.entries(explanation.weights).map(([key, value]) => `${weightName(key)} ${Math.round(value * 100)}%`).join(' · ')}
            </Text>
          ) : null}
          {typeof route.road_geometry?.distance_m === 'number' ? (
            <Text style={[type(fonts.light, 11, 14), styles.pad]}>Recorrido vial aproximado: {(route.road_geometry.distance_m / 1000).toFixed(2)} km</Text>
          ) : null}

          <View style={{ gap: 19, marginTop: 6 }}>
            {detections.map((detection, detectionIndex) => {
              const cameraName = devices.find((device) => device.external_id === detection.camera_id)?.name ?? detection.camera_id;
              const busy = confirmationBusyId === detection.detection_id;
              return (
                <Reveal key={detection.detection_id || String(detectionIndex)} index={detectionIndex} style={{ gap: 8 }}>
                  <Glass variant="tile" radius={24} style={styles.detection}>
                    <Icon name={detection.vehicle_type === 'motorcycle' ? 'motorcycleSmall' : 'car'} size={24} />
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={type(fonts.regular, 11, 13.2)}>
                        {detection.sequence_order}. {vehicleTypeName(detection.vehicle_type)}{detection.color ? ` · ${colorNamesEs[detection.color] ?? detection.color}` : ''}
                        {isAdmin && detection.license_plate ? ` · ${detection.license_plate}` : ''}
                      </Text>
                      <Text style={type(fonts.light, 8, 9.6)}>{cameraName} · {formatDate(detection.observed_at)} · {detection.direction}</Text>
                    </View>
                    <Text style={type(fonts.regular, 9, 10.8)}>
                      {isAdmin && detection.confirmation ? (detection.confirmation === 'match' ? 'Confirmado · ' : 'Rechazado · ') : ''}
                      {Math.round(detection.confidence * 100)}%
                    </Text>
                  </Glass>
                  {isAdmin ? (
                    detection.confirmation ? (
                      <SecondaryButton title="Quitar veredicto" disabled={busy} onPress={() => void setConfirmation(detection.detection_id, null)} style={styles.pad} />
                    ) : (
                      <View style={[styles.pad, { flexDirection: 'row', gap: 8 }]}>
                        <SecondaryButton title="Confirmar paso" disabled={busy} onPress={() => void setConfirmation(detection.detection_id, 'match')} style={{ flex: 1 }} />
                        <SecondaryButton title="Rechazar paso" disabled={busy} onPress={() => void setConfirmation(detection.detection_id, 'reject')} style={{ flex: 1 }} />
                      </View>
                    )
                  ) : null}
                </Reveal>
              );
            })}
          </View>
        </LinearGradient>
      </Sheet>

      <SafetyBanner />
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      {confirmationError ? <ErrorMessage>{confirmationError}</ErrorMessage> : null}
      {exportError ? <ErrorMessage>{exportError}</ErrorMessage> : null}
      <PrimaryButton
        title={isDemo ? 'Exportación no disponible en demo' : 'Exportar y compartir JSON auditado'}
        disabled={isDemo}
        loading={exporting}
        onPress={() => void exportAndShare()}
      />
    </Screen>
  );
}

function routeLabel(route: CandidateRoute, plate: string | null | undefined): string {
  const color = colorNamesEs[route.color ?? ''];
  const parts = [vehicleTypeName(String(route.vehicle_type ?? 'Vehículo')), color ? color.charAt(0).toUpperCase() + color.slice(1) : 'Color sin determinar'];
  if (plate) parts.push(plate);
  return parts.join(' | ');
}

function weightName(value: string): string {
  const names: Record<string, string> = {
    detection: 'detección',
    time: 'tiempo',
    appearance: 'apariencia',
    road: 'vía',
  };
  return names[value] ?? value;
}

const styles = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 17, marginTop: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, paddingBottom: 80 },
  detail: { borderRadius: 19, paddingVertical: 22, paddingHorizontal: 12, gap: 10, marginTop: 8 },
  detection: { minHeight: 43, flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 8, paddingLeft: 38, paddingRight: 25 },
  pad: { paddingHorizontal: 11 },
});
