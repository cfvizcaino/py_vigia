import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text } from 'react-native';
import { Camera, VisionCamera, useCameraDevice } from 'react-native-vision-camera';

import { Card, SecondaryButton } from '../components/ui';
import { EdgeEngine } from '../edge/engine';
import { ExpoOutboxStorage, Outbox } from '../edge/outbox';
import { loadColorModel, loadVehicleModel } from '../edge/model';
import { useVehicleFrameOutput } from '../native/FrameProcessor';
import type { EdgeConfiguration } from '../edge/config';
import type { EdgeStats } from '../edge/engine';
import type { LoadedModel } from '../edge/model';
import type { Detection } from '../edge/types';
import { colors } from '../theme/colors';

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
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const engineRef = useRef<EdgeEngine | null>(null);
  const device = useCameraDevice('back');

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
        );
        setModels({ detector, color });
      } catch (reason) {
        if (!cancelled) {
          setStartupError(reason instanceof Error ? reason.message : 'No fue posible iniciar Edge autónomo.');
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
    if (!engine) return;
    if (foreground) {
      engine.start();
      void activateKeepAwakeAsync(keepAwakeTag).catch((reason: unknown) => {
        setStartupError(reason instanceof Error ? reason.message : 'No fue posible mantener la pantalla activa.');
      });
    } else {
      void engine.stop().catch((reason: unknown) => {
        setStartupError(reason instanceof Error ? reason.message : 'No fue posible pausar Edge autónomo.');
      });
      void deactivateKeepAwake(keepAwakeTag);
    }
  }, [foreground, models]);

  const frameOutput = useVehicleFrameOutput({
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

  return (
    <Card title="Edge autónomo">
      {startupError ? <Text accessibilityRole="alert" style={styles.error}>{startupError}</Text> : null}
      {permissionGranted === false ? (
        <Text style={styles.body}>Permite el acceso a la cámara en los ajustes de Android para continuar.</Text>
      ) : null}
      {!models && !startupError ? <Text style={styles.body}>Preparando cámara y verificando los modelos TFLite…</Text> : null}
      {models && !device ? <Text style={styles.body}>No se encontró una cámara trasera disponible.</Text> : null}
      {models && device ? (
        <>
          <Camera
            device={device}
            isActive={foreground && permissionGranted === true}
            outputs={[frameOutput]}
            onError={(error) => engineRef.current?.reportError(error.message)}
            onStarted={() => setStartupError(null)}
            style={styles.camera}
          />
          <Text style={styles.body}>
            {foreground ? 'Inferencia local activa. El video no se envía al backend.' : 'Edge pausado mientras la app está en segundo plano.'}
          </Text>
          <Text style={styles.metric}>
            {stats ? `${stats.fps.toFixed(1)} fps · ${stats.inferenceMs} ms · ${stats.activeTracks} vehículos · ${stats.framesProcessed} frames` : 'Iniciando inferencia…'}
          </Text>
          <Text style={styles.metric}>
            {stats?.outbox
              ? `Outbox: ${stats.outbox.pending} pendientes · ${stats.outbox.delivered} enviados · ${stats.outbox.rejected} rechazados · ${stats.outbox.retries} reintentos`
              : 'Preparando outbox…'}
          </Text>
          {stats?.lastError ? <Text accessibilityRole="alert" style={styles.error}>{stats.lastError}</Text> : null}
        </>
      ) : null}
      <SecondaryButton title="Detener Edge autónomo" onPress={onStop} />
    </Card>
  );
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
  camera: { height: 260, width: '100%', backgroundColor: '#000', borderRadius: 8, overflow: 'hidden' },
  body: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  metric: { color: colors.text, fontSize: 13, lineHeight: 19 },
  error: { color: '#FFB4AB', fontSize: 14, lineHeight: 20 },
});
