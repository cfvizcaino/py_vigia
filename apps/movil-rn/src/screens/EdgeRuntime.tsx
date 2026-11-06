import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useMemo, useRef, useState } from 'react';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, VisionCamera, useCameraDevice } from 'react-native-vision-camera';

import { DetectionOverlay, previewAspectRatio } from '../components/DetectionOverlay';
import { ExpandablePreview } from '../components/ExpandablePreview';
import { Card, SecondaryButton } from '../components/ui';
import { EdgeEngine } from '../edge/engine';
import { ExpoOutboxStorage, Outbox } from '../edge/outbox';
import { loadColorModel, loadVehicleModel } from '../edge/model';
import { useVehicleFrameOutput } from '../native/FrameProcessor';
import type { ColorGate, ThumbnailGate } from '../native/FrameProcessor';
import { createThumbnailEncoder } from '../native/thumbnail';
import type { EdgeConfiguration } from '../edge/config';
import type { EdgeStats } from '../edge/engine';
import type { LoadedModel } from '../edge/model';
import type { Detection } from '../edge/types';
import { colors } from '../theme/colors';
import { useAppUpdate } from '../update/UpdateHost';
import type { UpdateLevel } from '../update/release';

const keepAwakeTag = 'vigia-edge-camera';

export function EdgeRuntime({ config, fps, extraRotation, onStop }: {
  config: EdgeConfiguration;
  fps: number;
  extraRotation: number;
  onStop: () => void;
}) {
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [models, setModels] = useState<{ detector: LoadedModel; color: LoadedModel } | null>(null);
  const [stats, setStats] = useState<EdgeStats | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [cameraStarted, setCameraStarted] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const engineRef = useRef<EdgeEngine | null>(null);
  const gatesRef = useRef<(gates: ThumbnailGate[] | null) => void>(() => undefined);
  const colorGatesRef = useRef<(gates: ColorGate[]) => void>(() => undefined);
  const device = useCameraDevice('back');
  const { available: updateLevel, showUpdate } = useAppUpdate();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const granted = await VisionCamera.requestCameraPermission();
        if (cancelled) return;
        setPermissionGranted(granted);
        if (!granted) throw new Error('VIGÍA necesita permiso de cámara para iniciar el modo edge.');
        const [detector, color] = await Promise.all([loadVehicleModel(), loadColorModel()]);
        if (cancelled) return;
        const outbox = new Outbox({
          storage: new ExpoOutboxStorage(config.cameraId),
          serverUrl: config.serverUrl,
          token: config.token,
        });
        engineRef.current = new EdgeEngine(
          config,
          { name: detector.manifest.name, digest: detector.manifest.sha256 },
          outbox,
          setStats,
          createThumbnailEncoder(),
          (gates) => gatesRef.current(gates),
          (gates) => colorGatesRef.current(gates),
        );
        setModels({ detector, color });
      } catch (reason) {
        if (!cancelled) {
          console.error('No fue posible iniciar Edge autónomo.', reason);
          setStartupError('No fue posible iniciar Edge autónomo. Revisa los permisos, la configuración y los modelos.');
        }
      }
    })();

    return () => {
      cancelled = true;
      const engine = engineRef.current;
      engineRef.current = null;
      if (engine) void engine.stop().catch((reason: unknown) => {
        console.error('No fue posible cerrar la sesión Edge.', reason);
      });
    };
  }, [config]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !device) return;
    if (foreground) {
      engine.start();
      void activateKeepAwakeAsync(keepAwakeTag).catch((reason: unknown) => {
        console.error('No fue posible mantener activa la pantalla de Edge.', reason);
        setRuntimeError('No fue posible mantener la pantalla activa.');
      });
    } else {
      void engine.stop().catch((reason: unknown) => {
        console.error('No fue posible pausar Edge autónomo.', reason);
        setRuntimeError('No fue posible pausar Edge autónomo.');
      });
      void deactivateKeepAwake(keepAwakeTag);
    }
  }, [device, foreground, models]);

  const { output: frameOutput, setThumbnailGates, setColorGates } = useVehicleFrameOutput({
    detector: models?.detector.model ?? null,
    colorModel: models?.color.model ?? null,
    inputSize: 320,
    detectorShape: models?.detector.manifest.output.shape ?? [1, 300, 6],
    detectorLabels: labelsForVehicles(models?.detector),
    colorLabels: labelsForColors(models?.color),
    fps,
    extraRotation,
    onFrameResult: (result) => engineRef.current?.process(result),
    onFrameError: (message) => engineRef.current?.reportError(message),
  });
  useEffect(() => {
    gatesRef.current = setThumbnailGates;
    colorGatesRef.current = setColorGates;
  }, [setThumbnailGates, setColorGates]);
  // A new array on every render would reconfigure the camera session.
  const outputs = useMemo(() => [frameOutput], [frameOutput]);

  return (
    <Card title="Edge autónomo">
      {startupError ? <Text accessibilityRole="alert" style={styles.error}>{startupError}</Text> : null}
      {permissionGranted === false ? (
        <Text style={styles.body}>Permite el acceso a la cámara en los ajustes de Android para continuar.</Text>
      ) : null}
      {!models && !startupError ? <Text style={styles.body}>Preparando cámara y verificando los modelos TFLite…</Text> : null}
      {models && !device ? <Text style={styles.body}>No se encontró una cámara trasera disponible.</Text> : null}
      {runtimeError ? <Text accessibilityRole="alert" style={styles.error}>{runtimeError}</Text> : null}
      {models && device && !startupError ? (
        <>
          <ExpandablePreview
            aspectRatio={stats?.overlay ? previewAspectRatio(stats.overlay.frameWidth, stats.overlay.frameHeight, extraRotation) : 3 / 4}
            inlineMaxHeight={460}
            footer={stats ? (
              <Text style={styles.metric}>
                {stats.fps.toFixed(1)} análisis/s · {stats.activeTracks} vehículo{stats.activeTracks === 1 ? '' : 's'} · {stats.outbox?.delivered ?? 0} eventos enviados
              </Text>
            ) : null}
            renderPreview={() => (
              <>
                <Camera
                  device={device}
                  isActive={foreground && permissionGranted === true}
                  outputs={outputs}
                  onError={(error) => {
                    console.error('Error de cámara en Edge autónomo.', error);
                    if (!cameraStarted) {
                      setStartupError('No fue posible iniciar la cámara de Edge. Revisa los permisos y vuelve a intentar.');
                      void engineRef.current?.stop().catch((reason: unknown) => {
                        console.error('No fue posible cerrar Edge después de un error de inicio.', reason);
                      });
                    } else {
                      engineRef.current?.reportError('Error de cámara durante el análisis.');
                    }
                  }}
                  onStarted={() => {
                    setCameraStarted(true);
                    setStartupError(null);
                    setRuntimeError(null);
                  }}
                  // TextureView: the default SurfaceView draws over the boxes.
                  implementationMode="compatible"
                  resizeMode="contain"
                  style={StyleSheet.absoluteFill}
                />
                <DetectionOverlay overlay={stats?.overlay ?? null} extraRotation={extraRotation} />
              </>
            )}
          />
          {foreground ? (
            stats ? (
              <EdgeStatusCard stats={stats} updateLevel={updateLevel} onUpdate={showUpdate} />
            ) : (
              <Text style={styles.body}>Iniciando inferencia…</Text>
            )
          ) : (
            <Text style={styles.body}>Edge pausado mientras la app está en segundo plano.</Text>
          )}
        </>
      ) : null}
      <SecondaryButton
        title={(startupError || (models && !device)) && !cameraStarted ? 'Volver a configuración' : 'Detener Edge autónomo'}
        onPress={onStop}
      />
    </Card>
  );
}

/** Whole-frame time (not only the model), then where it goes. */
function describeTimings(stats: EdgeStats): string {
  const t = stats.timings;
  if (!t) return `Ciclo total ${stats.inferenceMs} ms`;
  return `Ciclo total ${t.total.p50} ms (p95 ${t.total.p95}) · preparar ${t.prepare.p50} · detector ${t.detect.p50}`
    + ` · color ${t.color.p50} (${t.colorCropsPerFrame}/frame) · recorte ${t.thumbnail.p50}`;
}

/** Same status as the Flutter card: pace, events, colour, recortes, connection (E05) and app version (G04). */
function EdgeStatusCard({ stats, updateLevel, onUpdate }: { stats: EdgeStats; updateLevel: UpdateLevel; onUpdate: () => void }) {
  const outbox = stats.outbox;
  const healthy = !outbox?.lastError;
  return (
    <View style={[styles.status, healthy ? styles.statusOk : styles.statusWarn]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <MaterialIcons name={healthy ? 'sensors' : 'cloud-off'} size={22} color={healthy ? '#69D4A8' : '#FFC66D'} />
        <Text style={[styles.metric, { flex: 1 }]}>
          Detectando · {stats.fps.toFixed(1)} análisis/s · {stats.activeTracks} vehículo{stats.activeTracks === 1 ? '' : 's'}
        </Text>
      </View>
      <Text style={styles.muted}>
        {describeTimings(stats)} · {stats.snapshots} eventos generados · {outbox?.delivered ?? 0} enviados · {outbox?.pending ?? 0} en cola
        {outbox?.rejected ? ` · ${outbox.rejected} rechazados` : ''}
      </Text>
      <Text style={styles.muted}>
        Modelo: {stats.framesProcessed} analizados{stats.failures ? ` · ${stats.failures} fallidos` : ''}
      </Text>
      <Text style={styles.muted}>Color: activo{stats.colorFailures ? ` · ${stats.colorFailures} fallidos` : ''}</Text>
      <Text style={styles.muted}>
        {outbox && !outbox.thumbnailsAccepted
          ? 'Recortes: el centro no los guarda'
          : `Recortes: ${outbox?.thumbnails ?? 0} enviados${outbox?.thumbnailsDropped ? ` · ${outbox.thumbnailsDropped} descartados` : ''}${stats.thumbnailFailures ? ` · ${stats.thumbnailFailures} fallidos` : ''}`}
      </Text>
      {stats.lastError ? <Text accessibilityRole="alert" style={styles.error}>Detección: {stats.lastError}</Text> : null}
      {outbox?.lastError ? <Text style={styles.warning}>{describeOutboxError(outbox.lastError)}</Text> : null}
      {updateLevel !== 'none' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <MaterialIcons name="system-update" size={18} color="#FFC66D" />
          <Text style={[styles.warning, { flex: 1 }]}>
            {updateLevel === 'required'
              ? 'Esta versión de la app quedó por debajo del mínimo. Hay que actualizar.'
              : 'Hay una versión más nueva de la app.'}
          </Text>
          <Pressable accessibilityRole="button" onPress={onUpdate}>
            <Text style={{ color: colors.accent, fontWeight: '700' }}>Actualizar</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function describeOutboxError(code: string): string {
  if (code === 'NETWORK' || code === 'TIMEOUT') {
    return 'Sin conexión con el servidor: los eventos se guardan y se enviarán al volver la red.';
  }
  if (code === 'HTTP_401') return 'El servidor rechazó el token (vencido o revocado). Olvida este edge y configura uno nuevo.';
  if (code === 'HTTP_403') return 'El token pertenece a otra cámara.';
  if (code === 'HTTP_404') return 'La cámara ya no está registrada en el servidor.';
  if (code === 'OUTBOX_FULL') return 'La cola local está llena; se descartan eventos nuevos hasta recuperar conexión.';
  if (code.startsWith('REJECTED_')) return `El servidor rechazó un evento (${code.slice(9)}); se apartó y el resto sigue.`;
  return `Último error: ${code}`;
}

function labelsForVehicles(model: LoadedModel | undefined): Record<number, Detection['label']> {
  const result: Record<number, Detection['label']> = {};
  for (const [index, label] of Object.entries(model?.manifest.labels ?? {})) {
    if (label === 'car' || label === 'motorcycle') result[Number(index)] = label;
  }
  return result;
}

function labelsForColors(model: LoadedModel | undefined): Record<number, string> {
  const result: Record<number, string> = {};
  for (const [index, label] of Object.entries(model?.manifest.labels ?? {})) result[Number(index)] = label;
  return result;
}

const styles = StyleSheet.create({
  body: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  metric: { color: colors.text, fontSize: 13, lineHeight: 19 },
  error: { color: '#FFB4AB', fontSize: 14, lineHeight: 20 },
  muted: { color: '#9AA79F', fontSize: 12, lineHeight: 18 },
  warning: { color: '#FFE1B0', fontSize: 12, lineHeight: 18 },
  status: { borderRadius: 6, borderWidth: 1, padding: 12, gap: 4 },
  statusOk: { backgroundColor: '#1B2E2A', borderColor: '#2F5D52' },
  statusWarn: { backgroundColor: '#302517', borderColor: '#6B5326' },
});
