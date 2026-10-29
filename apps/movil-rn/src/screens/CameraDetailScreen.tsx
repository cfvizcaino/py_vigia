import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';

import { ApiError } from '../api/client';
import { colorNamesEs } from '../edge/colors';
import { Card, ErrorMessage, PrimaryButton, Screen } from '../components/ui';
import { useSession } from '../state/session';
import { colors } from '../theme/colors';
import { bogotaDateTime, parseApiDate } from '../time/bogota';
import type { DeviceDetection, EdgeCredential } from '../types/models';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'CameraDetail'>;

/**
 * Detail of one camera (B04): its recent detections for everyone; location and
 * credentials (issue, revoke) for admins (B05). The backend enforces roles.
 */
export function CameraDetailScreen({ navigation, route }: Props) {
  const { devices, user, isDemo, recentDetections, listCredentials, issueCredential, revokeCredential } = useSession();
  const device = devices.find((item) => item.id === route.params.deviceId);
  const isAdmin = user?.role === 'admin' && !isDemo;
  const [detections, setDetections] = useState<DeviceDetection[] | null>(null);
  const [detectionsError, setDetectionsError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<EdgeCredential[] | null>(null);
  const [credentialsError, setCredentialsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCredentials = useCallback(async () => {
    if (!isAdmin || !device) return;
    try {
      const all = await listCredentials();
      setCredentials(all.filter((credential) => credential.camera_id === device.external_id));
      setCredentialsError(null);
    } catch (reason) {
      setCredentialsError(reason instanceof ApiError ? reason.message : 'No fue posible cargar las credenciales.');
    }
  }, [device, isAdmin, listCredentials]);

  useEffect(() => {
    if (!device) return;
    navigation.setOptions({ title: device.external_id });
    let active = true;
    recentDetections(device.id)
      .then((items) => {
        if (active) setDetections(items);
      })
      .catch((reason: unknown) => {
        if (active) setDetectionsError(reason instanceof ApiError ? reason.message : 'No fue posible cargar las detecciones.');
      });
    if (isAdmin) {
      listCredentials()
        .then((all) => {
          if (active) setCredentials(all.filter((credential) => credential.camera_id === device.external_id));
        })
        .catch((reason: unknown) => {
          if (active) setCredentialsError(reason instanceof ApiError ? reason.message : 'No fue posible cargar las credenciales.');
        });
    }
    return () => {
      active = false;
    };
    // Only when the camera changes; reloads happen after each action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device?.id]);

  if (!device) {
    return (
      <Screen>
        <ErrorMessage>La cámara ya no está en la lista.</ErrorMessage>
      </Screen>
    );
  }

  const issue = async () => {
    setBusy(true);
    setError(null);
    try {
      const issued = await issueCredential(device.external_id);
      navigation.navigate('IssuedToken', {
        issued,
        command: `bash infra/edges/install-node-token.sh ${device.external_id} --rotate`,
      });
      void loadCredentials();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'No fue posible emitir la credencial.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = (credential: EdgeCredential) => {
    Alert.alert(
      '¿Revocar credencial?',
      `${device.external_id} dejará de publicar con este token. Los eventos pendientes quedan en su cola.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Revocar',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                await revokeCredential(credential.id);
                await loadCredentials();
              } catch (reason) {
                setError(reason instanceof ApiError ? reason.message : 'No fue posible revocar la credencial.');
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800' }}>{device.external_id}</Text>
          <StatusTag status={device.status} />
        </View>
        <Text style={{ color: colors.muted }}>{device.name}{device.camera_model ? ` · ${device.camera_model}` : ''}</Text>
        <Text style={{ color: colors.subtle, fontSize: 12 }}>{device.lat.toFixed(5)}, {device.lng.toFixed(5)}</Text>
        {isAdmin ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => navigation.navigate('RelocateEdge', { deviceId: device.id })}
            style={{ paddingVertical: 8 }}
          >
            <Text style={{ color: colors.accent, fontWeight: '700' }}>Cambiar ubicación</Text>
          </Pressable>
        ) : null}
      </View>

      <Card title="Detecciones recientes">
        {detectionsError ? <ErrorMessage>{detectionsError}</ErrorMessage> : null}
        {!detections && !detectionsError ? <ActivityIndicator color={colors.accent} /> : null}
        {detections && !detections.length ? (
          <Text style={{ color: colors.muted }}>Todavía no hay detecciones de esta cámara.</Text>
        ) : null}
        {detections?.slice(0, 15).map((detection) => (
          <View key={detection.id} style={{ gap: 2 }}>
            <Text style={{ color: colors.text }}>
              {detection.vehicle_type === 'motorcycle' ? 'Motocicleta' : 'Automóvil'} · {colorLabel(detection.color)}
            </Text>
            <Text style={{ color: colors.subtle, fontSize: 12 }}>
              {bogotaDateTime(parseApiDate(detection.observed_at))} · confianza {Math.round(detection.confidence * 100)}%
            </Text>
          </View>
        ))}
      </Card>

      {isAdmin ? (
        <Card title="Credenciales">
          {credentialsError ? <ErrorMessage>{credentialsError}</ErrorMessage> : null}
          {!credentials && !credentialsError ? <ActivityIndicator color={colors.accent} /> : null}
          {credentials && !credentials.length ? (
            <Text style={{ color: colors.muted }}>Sin credenciales: el nodo no puede publicar.</Text>
          ) : null}
          {credentials?.map((credential) => {
            const active = isActive(credential);
            return (
              <View key={credential.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: active ? colors.success : colors.muted, fontWeight: '700' }}>
                    {credential.revoked ? 'Revocada' : active ? 'Activa' : 'Vencida'}
                  </Text>
                  <Text style={{ color: colors.subtle, fontSize: 12 }}>
                    Emitida {bogotaDateTime(parseApiDate(credential.created_at))} · vence {bogotaDateTime(parseApiDate(credential.expires_at))}
                  </Text>
                </View>
                {active ? (
                  <Pressable accessibilityRole="button" disabled={busy} onPress={() => revoke(credential)}>
                    <Text style={{ color: colors.danger, fontWeight: '700' }}>Revocar</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
          <PrimaryButton title="Emitir nueva credencial" loading={busy} onPress={() => void issue()} />
          <Text style={{ color: colors.subtle, fontSize: 12 }}>
            Para rotar: emite una nueva, instálala en el nodo con --rotate y después revoca la anterior.
          </Text>
        </Card>
      ) : null}
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
    </Screen>
  );
}

export function StatusTag({ status }: { status: string }) {
  const online = status === 'online';
  return (
    <Text style={{ color: online ? colors.success : colors.warning, fontWeight: '700' }}>
      {online ? 'En línea' : 'Sin conexión'}
    </Text>
  );
}

function colorLabel(color: string | null): string {
  if (!color) return 'Sin especificar';
  const name = colorNamesEs[color];
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : color;
}

function isActive(credential: EdgeCredential): boolean {
  return !credential.revoked && parseApiDate(credential.expires_at).getTime() > Date.now();
}
