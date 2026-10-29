import * as Crypto from 'expo-crypto';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { Camera, useCameraDevice, usePhotoOutput, VisionCamera } from 'react-native-vision-camera';

import { Card, ChoiceRow, ErrorMessage, PrimaryButton, Screen, SecondaryButton } from '../components/ui';
import { createMjpegService } from '../native/mjpeg';
import type { CameraLink, MjpegService, MjpegStatus } from '../native/mjpeg';
import { colors } from '../theme/colors';

const port = 8080;
const keepAwakeTag = 'vigia-camera-server';
const accessAlphabet = 'abcdefghjkmnpqrstuvwxyz23456789';

export function CameraModeScreen() {
  const [link, setLink] = useState<CameraLink>('usb');
  const [fps, setFps] = useState(8);
  const [rotation, setRotation] = useState(0);
  const [accessKey, setAccessKey] = useState(createAccessKey);
  const [service, setService] = useState<MjpegService | null>(null);
  const [status, setStatus] = useState<MjpegStatus | null>(null);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [starting, setStarting] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [error, setError] = useState<string | null>(null);
  const serviceRef = useRef<MjpegService | null>(null);
  const captureBusy = useRef(false);
  const device = useCameraDevice('back');
  const photoOutput = usePhotoOutput({
    targetResolution: { width: 640, height: 480 },
    containerFormat: 'jpeg',
    quality: 0.72,
    qualityPrioritization: 'speed',
  });

  const stop = useCallback(async () => {
    const activeService = serviceRef.current;
    serviceRef.current = null;
    setService(null);
    setStreaming(false);
    setCameraReady(false);
    setStatus(null);
    await deactivateKeepAwake(keepAwakeTag);
    try {
      await activeService?.stop();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No fue posible detener el servidor MJPEG.');
    }
  }, []);

  const start = useCallback(async () => {
    if (Platform.OS !== 'android') {
      setError('El servidor MJPEG nativo está disponible en Android. iOS conserva la interfaz compartida.');
      return;
    }
    if (!device) {
      setError('No se encontró una cámara trasera disponible en este teléfono.');
      return;
    }
    setStarting(true);
    setError(null);
    let nextService: MjpegService | null = null;
    try {
      const granted = await VisionCamera.requestCameraPermission();
      if (!granted) throw new Error('VIGÍA necesita permiso de cámara para transmitir.');
      nextService = createMjpegService();
      await nextService.start(link, accessKey);
      serviceRef.current = nextService;
      setService(nextService);
      setAddresses(link === 'lan' ? nextService.getLocalAddresses() : []);
      await activateKeepAwakeAsync(keepAwakeTag);
      setStreaming(true);
    } catch (reason) {
      let message = reason instanceof Error ? reason.message : 'No fue posible iniciar la cámara y el servidor local.';
      try {
        await nextService?.stop();
      } catch (cleanupReason) {
        const cleanupMessage = cleanupReason instanceof Error ? cleanupReason.message : 'error desconocido';
        message = `${message} Además, no se pudo cerrar el servidor: ${cleanupMessage}`;
      }
      serviceRef.current = null;
      setService(null);
      setError(message);
    } finally {
      setStarting(false);
    }
  }, [accessKey, device, link]);

  const captureFrame = useCallback(async () => {
    const activeService = serviceRef.current;
    if (!activeService || captureBusy.current) return;
    captureBusy.current = true;
    let photo: Awaited<ReturnType<typeof photoOutput.capturePhoto>> | null = null;
    try {
      photo = await photoOutput.capturePhoto({ enableShutterSound: false }, {});
      const filePath = await photo.saveToTemporaryFileAsync();
      await activeService.publishJpegFile(filePath, rotation);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo codificar o publicar el frame JPEG.');
    } finally {
      photo?.dispose();
      captureBusy.current = false;
    }
  }, [photoOutput, rotation]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
      if (state !== 'active') void stop();
    });
    return () => subscription.remove();
  }, [stop]);

  useEffect(() => {
    return () => {
      const activeService = serviceRef.current;
      serviceRef.current = null;
      void activeService?.stop();
      void deactivateKeepAwake(keepAwakeTag);
    };
  }, []);

  useEffect(() => {
    if (!streaming || !cameraReady || !service || !foreground) return;
    const captureTimer = setInterval(() => void captureFrame(), 1000 / fps);
    const statusTimer = setInterval(() => {
      try {
        setStatus(service.getStatus());
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'No se pudo leer el estado del servidor MJPEG.');
      }
    }, 1000);
    return () => {
      clearInterval(captureTimer);
      clearInterval(statusTimer);
    };
  }, [cameraReady, captureFrame, fps, foreground, service, streaming]);

  return (
    <Screen>
      <Text style={styles.body}>
        El teléfono transmite la cámara a un nodo VIGÍA cercano. La detección y el envío al backend los realiza ese nodo; el video nunca se envía al servidor central.
      </Text>

      <Card title="Conexión">
        <ChoiceRow
          label="Enlace del nodo"
          value={link}
          choices={[{ label: 'Cable USB', value: 'usb' }, { label: 'Red local', value: 'lan' }]}
          onChange={(value) => {
            if (!streaming && (value === 'usb' || value === 'lan')) setLink(value);
          }}
        />
        <Text style={styles.note}>
          {link === 'usb'
            ? 'El servidor enlaza solo a loopback. adb forward permite acceder por el cable USB sin exponerlo a la red.'
            : 'El servidor se expone a la red local y exige la clave en cada solicitud.'}
        </Text>
      </Card>

      <Card title="Vista previa">
        {streaming && device ? (
          <Camera
            device={device}
            isActive={streaming && foreground}
            outputs={[photoOutput]}
            onStarted={() => {
              setCameraReady(true);
              setStarting(false);
            }}
            onError={(cameraError) => {
              setError(`No se pudo abrir la cámara: ${cameraError.message}`);
              void stop();
            }}
            style={styles.preview}
          />
        ) : (
          <View style={styles.previewPlaceholder}>
            <Text style={styles.note}>{Platform.OS === 'android' ? 'La cámara está detenida.' : 'El servidor MJPEG se habilitará en Android.'}</Text>
          </View>
        )}
        {status?.running ? (
          <Text style={styles.metric}>{status.fps.toFixed(1)} fps · {status.clients} clientes · {status.frames} frames</Text>
        ) : null}
        {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        {streaming ? (
          <SecondaryButton title="Detener transmisión" onPress={() => void stop()} />
        ) : (
          <PrimaryButton title="Iniciar transmisión" loading={starting} onPress={() => void start()} />
        )}
      </Card>

      <Card title="Calidad y orientación">
        <ChoiceRow
          label="Fotogramas por segundo"
          value={String(fps)}
          choices={[5, 8, 12, 15].map((value) => ({ label: String(value), value: String(value) }))}
          onChange={(value) => {
            if (!streaming) setFps(Number(value));
          }}
        />
        <ChoiceRow
          label="Rotación extra"
          value={String(rotation)}
          choices={[0, 90, 180, 270].map((value) => ({ label: `${value}°`, value: String(value) }))}
          onChange={(value) => {
            if (!streaming) setRotation(Number(value));
          }}
        />
        <Text style={styles.note}>Se solicita 640 × 480 a la cámara; los frames se limitan a 960 px de ancho y se vuelven a codificar como JPEG calidad 80. La cámara no captura audio.</Text>
      </Card>

      <Card title="Dirección local">
        {link === 'usb' ? (
          <>
            <Text style={styles.note}>En el PC, conecta el teléfono con depuración USB y reenvía el puerto:</Text>
            <Text selectable style={styles.code}>adb forward tcp:{port} tcp:{port}</Text>
            <Text selectable style={styles.code}>http://127.0.0.1:{port}/video</Text>
          </>
        ) : (
          <>
            <Text style={styles.note}>Clave temporal de acceso: {accessKey}</Text>
            <Text selectable style={styles.code}>bash infra/edges/install-node-token.sh CEL-XX http://IP_DEL_TELEFONO:{port}/video URL_SERVIDOR --auth</Text>
            {addresses.map((address) => (
              <Text key={address} selectable style={styles.code}>http://{address}:{port}/video?key={accessKey}</Text>
            ))}
            {!streaming ? <SecondaryButton title="Generar otra clave" onPress={() => setAccessKey(createAccessKey())} /> : null}
          </>
        )}
        <Text style={styles.note}>Rutas disponibles: /video (MJPEG), /shot.jpg (503 hasta el primer frame) y /status. El modo USB no requiere clave; LAN acepta ?key= o HTTP Basic.</Text>
      </Card>
    </Screen>
  );
}

function createAccessKey(): string {
  const random = Crypto.getRandomBytes(12);
  return Array.from(random, (byte) => accessAlphabet[byte % accessAlphabet.length] ?? 'a').join('');
}

const styles = StyleSheet.create({
  body: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  note: { color: colors.subtle, fontSize: 12, lineHeight: 18 },
  metric: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  code: { color: colors.text, fontSize: 12, lineHeight: 18, fontFamily: Platform.select({ android: 'monospace', default: 'Courier' }) },
  preview: { width: '100%', height: 240, backgroundColor: '#000', borderRadius: 8, overflow: 'hidden' },
  previewPlaceholder: { height: 180, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised, borderRadius: 8, padding: 18 },
});
