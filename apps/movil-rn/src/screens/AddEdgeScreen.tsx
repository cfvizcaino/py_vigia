import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ApiError } from '../api/client';
import { CameraMap } from '../components/CameraMap';
import { ChoiceRow, ErrorMessage, Field, PrimaryButton, Screen } from '../components/ui';
import {
  authByDefault, edgeSourceField, edgeSourceLabel, edgeSources, installCommand, needsNodePc,
  suggestEdgeId, suggestPhonePort, validateSource,
} from '../edge/sources';
import type { EdgeSource } from '../edge/sources';
import { useSession } from '../state/session';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'AddEdge'>;

/** Admin (F01–F02): registers the camera and issues its credential in one step. */
export function AddEdgeScreen({ navigation }: Props) {
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
    <Screen>
      <Text style={{ color: colors.muted, lineHeight: 20 }}>
        Registra la cámara en el servidor y emite su credencial. El nodo de visión que la procese usará ese token para publicar.
      </Text>
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
      <Field label="Equipo (opcional)" value={cameraModel} onChangeText={setCameraModel} placeholder="OPPO CPH2599" />

      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>Ubicación</Text>
        <Text style={{ color: colors.muted }}>Donde quedará la cámara. Las rutas dependen de este punto.</Text>
        <CameraMap devices={devices} height={240} point={point ?? undefined} onSelectPoint={setPoint} />
        <Text style={{ color: colors.subtle, fontSize: 12 }}>
          {point ? `${point[1].toFixed(5)}, ${point[0].toFixed(5)}` : 'Mantén pulsado el mapa o usa tu ubicación.'}
        </Text>
      </View>

      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>Fuente de video</Text>
        <Text style={{ color: colors.muted, lineHeight: 20 }}>
          Este teléfono puede detectar por sí mismo, o un nodo en un PC lee la cámara. Para un PC solo se usa para armar el comando de instalación; no se envía al servidor.
        </Text>
        {edgeSources.map((item) => (
          <Pressable
            key={item}
            accessibilityRole="radio"
            accessibilityState={{ selected: item === source }}
            onPress={() => changeSource(item)}
            style={{
              padding: 12,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: item === source ? colors.accent : colors.border,
              backgroundColor: item === source ? '#1B2E2A' : colors.surface,
            }}
          >
            <Text style={{ color: colors.text }}>{edgeSourceLabel[item]}</Text>
          </Pressable>
        ))}
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
          <Text style={{ color: colors.subtle, fontSize: 12 }}>
            Usa el modelo integrado: el teléfono detecta los vehículos y publica con su propio token. Ideal para cualquier Android con cámara trasera.
          </Text>
        )}
        {source === 'rtsp' || source === 'http' ? (
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: needsAuth }} onPress={() => setNeedsAuth((value) => !value)}>
            <Text style={{ color: colors.text }}>{needsAuth ? '☑' : '☐'} La cámara pide usuario y contraseña</Text>
            <Text style={{ color: colors.subtle, fontSize: 12 }}>El script del PC los pedirá sin mostrarlos.</Text>
          </Pressable>
        ) : null}
      </View>

      <ChoiceRow
        label="Vigencia del token"
        value={String(days)}
        onChange={(value) => setDays(Number(value))}
        choices={[30, 90, 180, 365].map((value) => ({ label: `${value} días`, value: String(value) }))}
      />
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      <PrimaryButton title="Registrar edge y emitir token" loading={saving} onPress={() => void submit()} />
    </Screen>
  );
}
