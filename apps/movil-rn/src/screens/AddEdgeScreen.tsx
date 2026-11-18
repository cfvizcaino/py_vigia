import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '../api/client';
import { LocationPicker } from '../components/LocationPicker';
import { useTransitionDone } from '../components/motion';
import { Icon } from '../components/Icon';
import { ErrorMessage, Field, Glass, GradientCard, OptionSheet, PrimaryButton, Screen } from '../components/ui';
import {
  authByDefault, edgeSourceField, edgeSourceLabel, edgeSources, installCommand, needsNodePc,
  suggestEdgeId, suggestPhonePort, validateSource,
} from '../edge/sources';
import type { EdgeSource } from '../edge/sources';
import { useSession } from '../state/session';
import { gradients } from '../theme/colors';
import { fonts, type } from '../theme/fonts';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'AddEdge'>;

/** Admin (F01–F02): registers the camera and issues its credential in one step. */
export function AddEdgeScreen({ navigation }: Props) {
  // The sheet slides up first; the map starts once it is in place.
  const mapReady = useTransitionDone(navigation);
  const { devices, baseUrl, createEdge, issueCredential } = useSession();
  const [cameraId, setCameraId] = useState(() => suggestEdgeId(devices));
  const [name, setName] = useState('');
  const [cameraModel, setCameraModel] = useState('');
  const [point, setPoint] = useState<[number, number] | null>(null);
  const [source, setSource] = useState<EdgeSource>('phoneUsb');
  const [sourceValue, setSourceValue] = useState(() => suggestPhonePort(suggestEdgeId(devices)));
  const [needsAuth, setNeedsAuth] = useState(authByDefault('phoneUsb'));
  const [days, setDays] = useState(90);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<'source' | 'days' | null>(null);

  const changeSource = (next: EdgeSource) => {
    setSource(next);
    setNeedsAuth(authByDefault(next));
    setSourceValue(next === 'phoneUsb' ? suggestPhonePort(cameraId) : '');
  };

  const submit = async () => {
    const id = cameraId.trim();
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(id)) {
      setError('El identificador solo puede tener letras, números, punto, guion y guion bajo.');
      return;
    }
    if (devices.some((device) => device.external_id === id)) {
      setError('Ya existe una cámara con ese identificador.');
      return;
    }
    if (!name.trim()) {
      setError('Escribe un nombre visible para la cámara.');
      return;
    }
    if (!point) {
      setError('Falta la ubicación de la cámara.');
      return;
    }
    const sourceIssue = validateSource(source, sourceValue);
    if (sourceIssue) {
      setError(sourceIssue);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const device = await createEdge({
        cameraId: id,
        name: name.trim(),
        lng: point[0],
        lat: point[1],
        ...(cameraModel.trim() ? { cameraModel: cameraModel.trim() } : {}),
      });
      let issued;
      try {
        issued = await issueCredential(device.external_id, days);
      } catch (reason) {
        // The camera exists; the token can be issued from its detail screen.
        setError(`Edge registrado, pero no se emitió el token: ${reason instanceof ApiError ? reason.message : 'error desconocido'}`);
        navigation.replace('CameraDetail', { deviceId: device.id });
        return;
      }
      navigation.replace('IssuedToken', needsNodePc(source)
        ? {
          issued,
          command: installCommand({ cameraId: device.external_id, source, value: sourceValue, serverUrl: baseUrl, needsAuth }),
        }
        : { issued, autonomous: true });
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'No fue posible registrar el edge.');
    } finally {
      setSaving(false);
    }
  };

  const field = edgeSourceField[source];
  return (
    <Screen back title={'Agregar\nedge'}>
      <Field
        label="Identificador"
        value={cameraId}
        onChangeText={(value) => {
          setCameraId(value);
          if (source === 'phoneUsb') setSourceValue(suggestPhonePort(value));
        }}
        autoCapitalize="characters"
      />
      <Field label="Nombre visible" value={name} onChangeText={setName} placeholder="Teléfono portería norte" />
      <Field label="Equipo (Opcional)" value={cameraModel} onChangeText={setCameraModel} placeholder="OPPO CPH2599" />

      <GradientCard colors={gradients.locationCard} style={styles.location}>
        <Icon name="locationSearching" size={24} style={{ alignSelf: 'center' }} />
        <Text style={[type(fonts.medium, 20, 24), styles.center]}>Ubicación</Text>
        <Text style={[type(fonts.light, 14, 16.8), styles.center, { marginBottom: 6 }]}>Donde quedará la cámara. Las rutas dependen de este punto</Text>
        {mapReady ? (
          <LocationPicker devices={devices} height={259} point={point ?? undefined} onChange={(next) => setPoint(next)} caption={{ title: 'Barranquilla, ATL', subtitle: 'Colombia' }} />
        ) : (
          <View style={{ height: 259, borderRadius: 24, backgroundColor: 'rgba(217,217,217,0.10)' }} />
        )}
      </GradientCard>

      <GradientCard colors={gradients.sourcePanel} locations={[0.03, 0.41, 1]} diagonal style={styles.source}>
        <Text style={[type(fonts.medium, 20, 24), styles.center]}>Fuente de vídeo</Text>
        <Text style={[type(fonts.regular, 14, 16.8), styles.center]}>Elige el modo por el cual se analizará el video.</Text>
        <View style={styles.tiles}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Fuente de video: ${edgeSourceLabel[source]}`} onPress={() => setPicker('source')} style={styles.tileBox}>
            <Glass radius={19} style={styles.tile}>
              <Icon name="antenna" size={24} />
              <Text style={[type(fonts.light, 11, 13.2), styles.center]}>{edgeSourceLabel[source]}</Text>
            </Glass>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Vigencia del token: ${days} días`} onPress={() => setPicker('days')} style={styles.tileBox}>
            <Glass radius={19} style={styles.tile}>
              <Icon name="vpnKey" size={24} />
              <Text style={[type(fonts.medium, 11, 13.2), styles.center]}>Vigencia del token</Text>
              <Text style={[type(fonts.light, 12, 14.4), styles.center]}>{days} días</Text>
            </Glass>
          </Pressable>
        </View>
        {needsNodePc(source) ? (
          <Field
            label={field.label}
            value={sourceValue}
            onChangeText={setSourceValue}
            placeholder={field.hint}
            keyboardType={source === 'phoneUsb' ? 'numeric' : 'default'}
            autoCapitalize="none"
          />
        ) : (
          <Text style={[type(fonts.light, 11.5, 15), styles.center, { opacity: 0.85 }]}>
            Usa el modelo integrado: el teléfono detecta los vehículos y publica con su propio token.
          </Text>
        )}
        {source === 'rtsp' || source === 'http' ? (
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: needsAuth }} onPress={() => setNeedsAuth((value) => !value)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Icon name={needsAuth ? 'ms_check_circle' : 'ms_lock'} size={18} color="#ffffff" />
            <View style={{ flex: 1 }}>
              <Text style={type(fonts.regular, 13)}>La cámara pide usuario y contraseña</Text>
              <Text style={[type(fonts.light, 11), { opacity: 0.7 }]}>El script del PC los pedirá sin mostrarlos.</Text>
            </View>
          </Pressable>
        ) : null}
        {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        <PrimaryButton title="Registrar edge y emitir token" loading={saving} onPress={() => void submit()} style={{ marginHorizontal: 25, marginTop: 6 }} />
      </GradientCard>

      <OptionSheet
        visible={picker === 'source'}
        title="Fuente de vídeo"
        value={source}
        onClose={() => setPicker(null)}
        onSelect={(value) => changeSource(value as EdgeSource)}
        options={edgeSources.map((item) => ({ value: item, label: edgeSourceLabel[item] }))}
      />
      <OptionSheet
        visible={picker === 'days'}
        title="Vigencia del token"
        value={String(days)}
        onClose={() => setPicker(null)}
        onSelect={(value) => setDays(Number(value))}
        options={[30, 90, 180, 365].map((value) => ({ value: String(value), label: `${value} días` }))}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  location: { padding: 18, gap: 6, borderWidth: 1, borderColor: 'rgba(157,118,248,0.3)' },
  source: { paddingVertical: 34, paddingHorizontal: 20, gap: 14 },
  tiles: { flexDirection: 'row', gap: 16, marginTop: 10 },
  tileBox: { flex: 1 },
  tile: { height: 119, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 10 },
});
