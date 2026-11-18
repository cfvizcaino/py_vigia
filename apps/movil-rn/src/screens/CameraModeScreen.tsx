import * as Crypto from 'expo-crypto';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { VisionCamera } from 'react-native-vision-camera';

import { ExpandablePreview } from '../components/ExpandablePreview';
import { Icon } from '../components/Icon';
import { Card, Chip, ChoiceRow, Code, ErrorMessage, Notice, PrimaryButton, Screen, SecondaryButton, StatusPill } from '../components/ui';
import { CameraStreamView, createMjpegService } from '../native/mjpeg';
import type { CameraLink, MjpegService, MjpegStatus } from '../native/mjpeg';
import { fonts, type } from '../theme/fonts';

const port = 8080;
const keepAwakeTag = 'vigia-camera-server';
const accessAlphabet = 'abcdefghjkmnpqrstuvwxyz23456789';

export function CameraModeScreen() {
  // Local const so the null check carries into the preview callback.
  const StreamView = CameraStreamView;
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
      console.error('No fue posible detener el servidor MJPEG.', reason);
      setError('No fue posible detener el servidor de cámara.');
    }
  }, []);

  const start = useCallback(async () => {
    if (Platform.OS !== 'android' || !CameraStreamView) {
      setError('El modo cámara todavía solo está disponible en Android.');
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
      console.error('No fue posible iniciar la cámara y el servidor local.', reason);
      try {
        await nextService?.stop();
      } catch (cleanupReason) {
        console.error('No fue posible cerrar el servidor MJPEG después de un error de inicio.', cleanupReason);
      }
      serviceRef.current = null;
      setService(null);
      setError('No fue posible iniciar la cámara. Revisa los permisos y vuelve a intentar.');
    } finally {
      setStarting(false);
    }
  }, [accessKey, link]);

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
    const statusTimer = setInterval(() => {
      try {
        setStatus(service.getStatus());
      } catch (reason) {
        console.error('No se pudo leer el estado del servidor MJPEG.', reason);
        setError('No se pudo leer el estado de la cámara.');
      }
    }, 1000);
    return () => clearInterval(statusTimer);
  }, [cameraReady, foreground, service, streaming]);

  const metric = status?.running ? `Transmitiendo · ${status.fps.toFixed(1)} fps · ${status.clients} ${status.clients === 1 ? 'nodo conectado' : 'nodos conectados'}` : null;
  return (
    <Screen back title={'Modo\ncámara'}>
      <Text style={[type(fonts.light, 11.5, 16, 0), styles.center, { opacity: 0.75 }]}>
        Este teléfono transmite su cámara a un nodo VIGÍA cercano. La detección y el envío al backend los hace ese nodo; el video nunca se envía al servidor central.
      </Text>

      <Card title="Enlace del nodo" icon={link === 'usb' ? 'ms_usb' : 'ms_wifi'}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {([['usb', 'Cable USB', 'ms_usb'], ['lan', 'Red local', 'ms_wifi']] as const).map(([value, label, icon]) => (
            <Chip key={value} label={label} icon={icon} grow selected={link === value} onPress={() => { if (!streaming) setLink(value); }} />
          ))}
        </View>
        {link === 'usb' ? (
          <Notice tone="ok" icon="ms_check_circle">Recomendado: el servidor enlaza solo a loopback; adb forward lo expone por el cable USB, no por la red.</Notice>
        ) : (
          <Notice tone="warn" icon="ms_warning">Cualquiera en tu Wi-Fi podría intentar conectarse: el servidor exige la clave en cada solicitud.</Notice>
        )}
      </Card>

      <Card title="Vista previa" icon="ms_videocam">
        {metric ? <StatusPill text={metric} tone="ok" /> : null}
        {streaming && StreamView ? (
          <ExpandablePreview
            // The camera delivers 1280 × 720; upright it is portrait unless turned 90° or 270°.
            aspectRatio={rotation === 90 || rotation === 270 ? 16 / 9 : 9 / 16}
            inlineMaxHeight={420}
            footer={metric ? <Text style={type(fonts.medium, 12)}>{metric} · {status?.frames ?? 0} frames</Text> : null}
            renderPreview={() => (
              <StreamView
                active={streaming && foreground}
                fps={fps}
                extraRotation={rotation}
                onCameraStarted={() => {
                  setCameraReady(true);
                  setStarting(false);
                }}
                onCameraError={(event) => {
                  console.error('No se pudo abrir la cámara MJPEG.', event.nativeEvent.message);
                  setError('No se pudo abrir la cámara. Revisa los permisos y vuelve a intentar.');
                  void stop();
                }}
                style={StyleSheet.absoluteFill}
              />
            )}
          />
        ) : (
          <View style={styles.previewPlaceholder}>
            <Icon name="ms_videocam" size={32} color="rgba(227,227,227,0.6)" />
            <Text style={[type(fonts.light, 12), { opacity: 0.7 }]}>La cámara está detenida.</Text>
          </View>
        )}
        {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        {streaming ? (
          <SecondaryButton title="Detener transmisión" icon="ms_stop_circle" onPress={() => void stop()} />
        ) : (
          <PrimaryButton title="Iniciar transmisión" icon="ms_play_arrow" loading={starting} onPress={() => void start()} />
        )}
      </Card>

      <Card title="Calidad y orientación" icon="ms_speed">
        <ChoiceRow
          label="Fotogramas por segundo"
          value={String(fps)}
          grow
          choices={[5, 8, 12, 15].map((value) => ({ label: String(value), value: String(value) }))}
          onChange={(value) => {
            if (!streaming) setFps(Number(value));
          }}
        />
        <ChoiceRow
          label="Rotación extra"
          value={String(rotation)}
          grow
          choices={[0, 90, 180, 270].map((value) => ({ label: `${value}°`, value: String(value) }))}
          onChange={(value) => {
            if (!streaming) setRotation(Number(value));
          }}
        />
        <Text style={[type(fonts.light, 10.5, 14, 0), { opacity: 0.6 }]}>
          Usa la rotación si el teléfono queda montado de lado. La cámara entrega 1280 × 720; cada cuadro sale a 640 × 360, JPEG calidad 70, sin audio.
        </Text>
      </Card>

      <Card title="En el PC del nodo" icon="ms_terminal">
        {link === 'usb' ? (
          <>
            <Text style={[type(fonts.light, 11.5, 17, 0), { opacity: 0.8 }]}>1. Conecta este teléfono por USB con la depuración activada.{'\n'}2. Reenvía el puerto y abre el video:</Text>
            <Code>{`adb forward tcp:${port} tcp:${port}\nhttp://127.0.0.1:${port}/video`}</Code>
          </>
        ) : (
          <>
            <Text style={[type(fonts.light, 11.5, 16, 0), { opacity: 0.8 }]}>Instala el nodo con esta fuente; el script pedirá la clave temporal.</Text>
            <Code>{`bash infra/edges/install-node-token.sh CEL-XX http://IP_DEL_TELEFONO:${port}/video URL_SERVIDOR --auth`}</Code>
            {addresses.map((address) => (
              <Code key={address}>{`http://${address}:${port}/video?key=${accessKey}`}</Code>
            ))}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={styles.key}>
                <Icon name="ms_key" size={16} />
                <Text selectable style={type(fonts.mono, 12.5, 16, 0)}>Clave: {accessKey}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Generar otra clave" disabled={streaming} onPress={() => setAccessKey(createAccessKey())} style={[styles.newKey, streaming && { opacity: 0.45 }]}>
                <Icon name="ms_autorenew" size={16} />
                <Text style={type(fonts.regular, 12)}>Nueva clave</Text>
              </Pressable>
            </View>
          </>
        )}
        <Text style={[type(fonts.light, 10.5, 14, 0), { opacity: 0.6 }]}>Rutas disponibles: /video (MJPEG), /shot.jpg (503 hasta el primer frame) y /status. El modo USB no requiere clave; LAN acepta ?key= o HTTP Basic.</Text>
      </Card>
      <Notice>Mantén la app abierta mientras transmite (la pantalla puede apagarse; la transmisión sigue).</Notice>
    </Screen>
  );
}

function createAccessKey(): string {
  const random = Crypto.getRandomBytes(12);
  return Array.from(random, (byte) => accessAlphabet[byte % accessAlphabet.length] ?? 'a').join('');
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  previewPlaceholder: { height: 194, alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: '#12052a' },
  key: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'rgba(255,255,255,0.07)' },
  newKey: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
});
