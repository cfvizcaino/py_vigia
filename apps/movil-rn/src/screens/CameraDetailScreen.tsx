import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '../api/client';
import { colorNamesEs } from '../edge/colors';
import { Icon } from '../components/Icon';
import { Dialog, ErrorMessage, Glass, GradientCard, PillButton, PrimaryButton, Screen } from '../components/ui';
import { useSession } from '../state/session';
import { colors, gradients } from '../theme/colors';
import { fonts, type } from '../theme/fonts';
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
  const [revoking, setRevoking] = useState<EdgeCredential | null>(null);

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
      <Screen back>
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

  const confirmRevoke = async () => {
    const credential = revoking;
    if (!credential) return;
    setRevoking(null);
    setBusy(true);
    try {
      await revokeCredential(credential.id);
      await loadCredentials();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'No fue posible revocar la credencial.');
    } finally {
      setBusy(false);
    }
  };

  const online = device.status === 'online';
  return (
    <Screen back glow={false} contentStyle={{ paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0, flexGrow: 1 }}>
      <GradientCard colors={gradients.sheet} radius={24} style={styles.sheet}>
        <View style={{ paddingHorizontal: 27, gap: 4 }}>
          <Text accessibilityRole="header" style={type(fonts.poppins, 32)}>{device.name || device.external_id}</Text>
          <Text style={type(fonts.light, 12)}>
            {device.external_id} · {device.lat.toFixed(4)}, {device.lng.toFixed(4)} | <Text style={{ fontFamily: fonts.medium }}>{online ? 'En Línea' : 'Sin conexión'}</Text>
          </Text>
          {isAdmin ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cambiar ubicación"
              disabled={busy}
              hitSlop={8}
              onPress={() => navigation.navigate('RelocateEdge', { deviceId: device.id })}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 14 }}
            >
              <Icon name="editLocation" size={20} />
              <Text style={[type(fonts.light, 12), { textDecorationLine: 'underline' }]}>Cambiar ubicación</Text>
            </Pressable>
          ) : null}
        </View>

        <Glass variant="strong" radius={24} style={styles.panel}>
          <Text style={[type(fonts.medium, 20, 24), { marginLeft: 13, marginBottom: 8 }]}>Detecciones recientes</Text>
          {detectionsError ? <ErrorMessage>{detectionsError}</ErrorMessage> : null}
          {!detections && !detectionsError ? <ActivityIndicator color={colors.accent} /> : null}
          {detections && !detections.length ? (
            <Text style={[type(fonts.light, 13), { marginLeft: 13 }]}>Todavía no hay detecciones de esta cámara.</Text>
          ) : null}
          {detections?.slice(0, 15).map((detection, index) => (
            <View key={detection.id} style={[styles.detection, index > 0 && styles.separator]}>
              <Icon name={detection.vehicle_type === 'motorcycle' ? 'motorcycle' : 'car'} size={27} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={type(fonts.medium, 14, 16.8)}>
                  {detection.vehicle_type === 'motorcycle' ? 'Motocicleta' : 'Automóvil'} | {colorLabel(detection.color)}
                </Text>
                <Text style={type(fonts.light, 11, 13.2)}>
                  {bogotaDateTime(parseApiDate(detection.observed_at)).replace(/-/g, '/').replace(' ', '  ')}  Confianza {Math.round(detection.confidence * 100)}%
                </Text>
              </View>
            </View>
          ))}
        </Glass>

        {isAdmin ? (
          <Glass variant="strong" radius={24} style={[styles.panel, { gap: 16 }]}>
            {credentialsError ? <ErrorMessage>{credentialsError}</ErrorMessage> : null}
            {!credentials && !credentialsError ? <ActivityIndicator color={colors.accent} /> : null}
            {credentials && !credentials.length ? (
              <View style={styles.credential}>
                <Icon name="credentialKey" size={31} />
                <Text style={[type(fonts.medium, 18, 21.6), { flex: 1 }]}>Sin credenciales: el nodo no puede publicar.</Text>
              </View>
            ) : null}
            {credentials?.map((credential) => {
              const active = isActive(credential);
              return (
                <View key={credential.id} style={styles.credential}>
                  <Icon name="credentialKey" size={31} />
                  <View style={{ flex: 1, gap: 5 }}>
                    <Text style={type(fonts.medium, 18, 21.6)}>Credencial: {credential.revoked ? 'Revocada' : active ? 'Activa' : 'Vencida'}</Text>
                    <Text style={type(fonts.regular, 13, 15.6)}>
                      Emitida {bogotaDateTime(parseApiDate(credential.created_at)).slice(0, 10).replace(/-/g, '/')}{'\n'}Vence {bogotaDateTime(parseApiDate(credential.expires_at)).slice(0, 10).replace(/-/g, '/')}
                    </Text>
                  </View>
                  {active ? (
                    <Pressable accessibilityRole="button" accessibilityLabel="Revocar" disabled={busy} hitSlop={10} onPress={() => setRevoking(credential)} style={styles.revoke}>
                      <Text style={[type(fonts.regular, 9, 10.8), { textAlign: 'center' }]}>Revocar</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
            <PrimaryButton title="Emitir nueva credencial" loading={busy} onPress={() => void issue()} style={{ marginHorizontal: 30 }} />
            <Text style={[type(fonts.light, 11, 14), { opacity: 0.7, textAlign: 'center' }]}>
              Para rotar: emite una nueva, instálala en el nodo con --rotate y después revoca la anterior.
            </Text>
          </Glass>
        ) : null}
        {error ? <View style={{ paddingHorizontal: 16 }}><ErrorMessage>{error}</ErrorMessage></View> : null}
      </GradientCard>

      <Dialog
        visible={revoking !== null}
        title="Revocar credencial"
        body={`${device.external_id} dejará de publicar con este token.\nLos eventos pendientes quedan en su cola.`}
        onRequestClose={() => setRevoking(null)}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
          <Pressable accessibilityRole="button" hitSlop={10} onPress={() => setRevoking(null)} style={{ width: 91 }}>
            <Text style={[type(fonts.poppins, 16), { textAlign: 'center' }]}>Cancelar</Text>
          </Pressable>
          <PillButton title="Revocar" variant="accent" height={32} fontSize={16} onPress={() => void confirmRevoke()} style={{ width: 108 }} />
        </View>
      </Dialog>
    </Screen>
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

const styles = StyleSheet.create({
  sheet: { flexGrow: 1, marginTop: 10, paddingTop: 38, paddingHorizontal: 16, paddingBottom: 32, gap: 24 },
  panel: { paddingVertical: 22, paddingHorizontal: 10 },
  detection: { flexDirection: 'row', alignItems: 'center', gap: 21, paddingVertical: 12, paddingHorizontal: 18 },
  separator: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.5)' },
  credential: { flexDirection: 'row', alignItems: 'center', gap: 19, paddingHorizontal: 24 },
  revoke: { width: 63, height: 18, borderRadius: 24, borderWidth: 1, borderColor: '#ffffff', justifyContent: 'center', alignSelf: 'flex-start' },
});
