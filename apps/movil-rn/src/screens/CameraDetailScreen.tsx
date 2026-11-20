import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '../api/client';
import { colorNamesEs } from '../edge/colors';
import { Icon } from '../components/Icon';
import { Dialog, ErrorMessage, Glass, GradientCard, PillButton, PrimaryButton, Screen } from '../components/ui';
import { activityDetail, activityExplanation, activityLabel } from '../state/activity';
import { useSession } from '../state/session';
import { colors, gradients } from '../theme/colors';
import { fonts, type } from '../theme/fonts';
import { bogotaDateTime, parseApiDate } from '../time/bogota';
import type { Device, DeviceDetection, EdgeCredential } from '../types/models';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'CameraDetail'>;

/**
 * Detail of one camera (B04): its recent detections for everyone; location and
 * credentials (issue, revoke) for admins (B05). The backend enforces roles.
 */
export function CameraDetailScreen({ navigation, route }: Props) {
  const { devices, user, isDemo, recentDetections, listCredentials, issueCredential, revokeCredential, deleteDevice } = useSession();
  // While deleting, the session drops the camera from the list before we go back:
  // keep showing it so the screen does not flash «La cámara ya no está en la lista».
  const [deleting, setDeleting] = useState<Device | null>(null);
  const device = devices.find((item) => item.id === route.params.deviceId) ?? deleting ?? undefined;
  const isAdmin = user?.role === 'admin' && !isDemo;
  const [detections, setDetections] = useState<DeviceDetection[] | null>(null);
  const [detectionsError, setDetectionsError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<EdgeCredential[] | null>(null);
  const [credentialsError, setCredentialsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<EdgeCredential | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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

  const confirmDelete = async () => {
    setConfirmingDelete(false);
    setBusy(true);
    setError(null);
    setDeleting(device);
    try {
      await deleteDevice(device.id);
      Alert.alert('Nodo eliminado');
      navigation.goBack();
    } catch (reason) {
      if (reason instanceof ApiError && reason.statusCode === 404) {
        Alert.alert('Este nodo ya no existe');
        navigation.goBack();
      } else {
        setDeleting(null);
        setError(reason instanceof ApiError && reason.statusCode === 403
          ? 'Solo un administrador puede eliminar nodos'
          : reason instanceof ApiError ? reason.message : 'No fue posible eliminar el nodo. Revisa la conexión e inténtalo de nuevo.');
      }
    } finally {
      setBusy(false);
    }
  };

  const activity = activityLabel(device);
  const activityText = activityDetail(device.activity);
  const explanation = activityExplanation(device.activity);
  return (
    <Screen back glow={false} contentStyle={{ paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0, flexGrow: 1 }}>
      <GradientCard colors={gradients.sheet} radius={24} style={styles.sheet}>
        <View style={{ paddingHorizontal: 27, gap: 4 }}>
          <Text accessibilityRole="header" style={type(fonts.poppins, 32)}>{device.name || device.external_id}</Text>
          <Text style={type(fonts.light, 12)}>
            {device.external_id} · {device.lat.toFixed(4)}, {device.lng.toFixed(4)} | <Text style={{ fontFamily: fonts.medium, color: activity.tone === 'warn' ? colors.warning : undefined }}>{activity.label}</Text>
          </Text>
          {activityText ? <Text style={[type(fonts.light, 11.5, 15), { opacity: 0.8 }]}>{activityText}</Text> : null}
          {explanation && activity.tone !== 'ok' ? <Text style={[type(fonts.light, 11.5, 15), { opacity: 0.7 }]}>{explanation}</Text> : null}
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
        {isAdmin ? (
          <View style={styles.deleteZone}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Eliminar nodo"
              disabled={busy}
              onPress={() => setConfirmingDelete(true)}
              style={[styles.deleteButton, busy && styles.disabled]}
            >
              <Text style={styles.deleteButtonText}>Eliminar nodo</Text>
            </Pressable>
          </View>
        ) : null}
        {error ? <View style={{ paddingHorizontal: 16 }}><ErrorMessage>{error}</ErrorMessage></View> : null}
      </GradientCard>

      <Dialog
        visible={confirmingDelete}
        title="¿Estás seguro de eliminar este nodo?"
        body={`«${device.name || device.external_id}» dejará de enviar datos y su token quedará revocado. El historial de detecciones se conserva.`}
        onRequestClose={() => setConfirmingDelete(false)}
      >
        <View style={styles.deleteActions}>
          <Pressable accessibilityRole="button" hitSlop={10} onPress={() => setConfirmingDelete(false)} style={{ width: 91 }}>
            <Text style={[type(fonts.poppins, 16), { textAlign: 'center' }]}>Cancelar</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void confirmDelete()}
            style={[styles.confirmDeleteButton, busy && styles.disabled]}
          >
            <Text style={[type(fonts.medium, 15), { textAlign: 'center' }]}>Eliminar</Text>
          </Pressable>
        </View>
      </Dialog>

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
  deleteZone: { marginHorizontal: 24, marginTop: 8, paddingTop: 20, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.28)' },
  deleteButton: { minHeight: 46, justifyContent: 'center', alignItems: 'center', borderRadius: 24, borderWidth: 1, borderColor: colors.danger, backgroundColor: 'rgba(255,82,82,0.16)' },
  deleteButtonText: { ...type(fonts.medium, 14), color: colors.danger },
  deleteActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  confirmDeleteButton: { width: 108, minHeight: 36, justifyContent: 'center', borderRadius: 22, backgroundColor: colors.danger },
  disabled: { opacity: 0.45 },
});
