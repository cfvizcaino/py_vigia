import { useState } from 'react';
import { Share, Text, View } from 'react-native';

import { Card, DemoBadge, EmptyState, ErrorMessage, formatDate, PrimaryButton, Screen } from '../components/ui';
import { RouteMap } from '../components/RouteMap';
import { colorNamesEs } from '../edge/colors';
import { useSession } from '../state/session';
import { colors } from '../theme/colors';

export function ResultsScreen() {
  const { activeResult, devices, isDemo, exportResult, error } = useSession();
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  if (!activeResult) return <Screen scroll={false}><EmptyState title="Sin resultados" description="Ejecuta una consulta para ver las trayectorias candidatas." /></Screen>;

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

  return (
    <Screen>
      {isDemo ? <DemoBadge /> : null}
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>{activeResult.routes.length} rutas candidatas</Text>
      <Text style={{ color: colors.muted }}>{activeResult.candidate_detection_count} detecciones candidatas · consulta {String(activeResult.query.id)}</Text>
      {activeResult.routes.map((route, index) => {
        const explanation = route.explanation as { weights?: Record<string, number> } | undefined;
        const cameras = Array.isArray(route.camera_ids) ? route.camera_ids.join(' → ') : 'Cámaras no disponibles';
        return (
          <Card key={String(route.id ?? index)}>
            <Text style={{ color: colors.accent, fontSize: 18, fontWeight: '800' }}>Ruta candidata {String(route.rank ?? index + 1)} · {Math.round(Number(route.confidence ?? 0) * 100)} pts</Text>
            <Text style={{ color: colors.muted }}>{String(route.vehicle_type ?? 'Vehículo')} · {colorNamesEs[route.color ?? ''] ?? 'Color sin determinar'} · {cameras}</Text>
            {route.has_distant_gaps ? <Text style={{ color: colors.warning }}>Hay saltos distantes entre observaciones.</Text> : null}
            <Text style={{ color: colors.subtle }}>Es un puntaje de ranking, no una probabilidad de identificación.</Text>
            {explanation?.weights ? <Text style={{ color: colors.muted }}>Explicación: {Object.entries(explanation.weights).map(([key, value]) => `${key} ${Math.round(value * 100)}%`).join(' · ')}</Text> : null}
            <RouteMap route={route} devices={activeResult.nearby_devices} />
            {typeof route.road_geometry?.distance_m === 'number' ? (
              <Text style={{ color: colors.muted }}>Recorrido vial aproximado: {(route.road_geometry.distance_m / 1000).toFixed(2)} km</Text>
            ) : null}
            <View style={{ gap: 5 }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Línea de tiempo</Text>
              {[...route.detections].sort((left, right) => left.sequence_order - right.sequence_order).map((detection, detectionIndex) => {
                const cameraName = devices.find((device) => device.external_id === detection.camera_id)?.name ?? detection.camera_id;
                return (
                  <Text key={detection.detection_id || String(detectionIndex)} style={{ color: colors.muted, lineHeight: 20 }}>
                    {detection.sequence_order}. {formatDate(detection.observed_at)} · {cameraName} · {detection.direction} · {detection.vehicle_type}
                    {detection.color ? ` ${colorNamesEs[detection.color] ?? detection.color}` : ''} · confianza {Math.round(detection.confidence * 100)}%
                  </Text>
                );
              })}
            </View>
          </Card>
        );
      })}
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
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
