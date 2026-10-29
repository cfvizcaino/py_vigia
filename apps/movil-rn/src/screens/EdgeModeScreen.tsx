import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { Card, ChoiceRow, ErrorMessage, Field, PrimaryButton, Screen } from '../components/ui';
import {
  loadEdgeConfiguration,
  readEdgeConfiguration,
  saveEdgeConfiguration,
  validateEdgeServerUrl,
  verifyEdgeToken,
} from '../edge/config';
import type { EdgeConfiguration } from '../edge/config';
import { EdgeRuntime } from './EdgeRuntime';
import { colors } from '../theme/colors';

const fpsOptions = [
  { label: '5 fps', value: '5' },
  { label: '8 fps', value: '8' },
  { label: '12 fps', value: '12' },
  { label: '15 fps', value: '15' },
];

const rotationOptions = [
  { label: '0°', value: '0' },
  { label: '90°', value: '90' },
  { label: '180°', value: '180' },
  { label: '270°', value: '270' },
];

export function EdgeModeScreen() {
  const [cameraId, setCameraId] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [token, setToken] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [fps, setFps] = useState('8');
  const [rotation, setRotation] = useState('0');
  const [runtimeConfig, setRuntimeConfig] = useState<EdgeConfiguration | null>(null);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadEdgeConfiguration()
      .then((configuration) => {
        if (!active) return;
        setCameraId(configuration.cameraId);
        setServerUrl(configuration.serverUrl);
        setHasToken(configuration.hasToken);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'No fue posible leer la configuración Edge.');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const cleanCameraId = cameraId.trim();
      const cleanServerUrl = serverUrl.trim().replace(/\/+$/, '');
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(cleanCameraId)) {
        throw new Error('El identificador de cámara solo puede contener letras, números, punto, guion y guion bajo.');
      }
      const urlIssue = validateEdgeServerUrl(cleanServerUrl);
      if (urlIssue) throw new Error(urlIssue);
      const previous = await readEdgeConfiguration();
      const cleanToken = token.trim() || previous?.token || '';
      if (!cleanToken) throw new Error('Ingresa el token de edge emitido por un administrador.');
      const configuration = { cameraId: cleanCameraId, serverUrl: cleanServerUrl, token: cleanToken };
      await verifyEdgeToken(configuration);
      await saveEdgeConfiguration(configuration);
      setRuntimeConfig(configuration);
      setHasToken(true);
      setToken('');
      setNotice('Token verificado mediante un envelope vacío y configuración guardada de forma segura.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No fue posible verificar o guardar la configuración Edge.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Text style={{ color: colors.muted, lineHeight: 21 }}>
        Edge autónomo analiza en este teléfono con los modelos TFLite y envía envelopes al backend. Los frames de cámara no se transmiten al centro.
      </Text>
      <Card title="Configuración del edge">
        <Field label="Identificador de cámara" value={cameraId} onChangeText={setCameraId} placeholder="CEL-01" autoCapitalize="characters" />
        <Field label="URL del backend" value={serverUrl} onChangeText={setServerUrl} placeholder="https://vigia.ejemplo.org" keyboardType="url" />
        <Field
          label={hasToken ? 'Token edge (dejar vacío para conservarlo)' : 'Token edge'}
          value={token}
          onChangeText={setToken}
          placeholder={hasToken ? 'Token guardado en Keychain/Keystore' : 'Token emitido por administración'}
          secureTextEntry
          autoCapitalize="none"
        />
        <Text style={{ color: colors.warning, fontSize: 13, lineHeight: 19 }}>
          El token se guarda únicamente en el almacenamiento seguro del sistema. HTTP se admite solo en redes locales.
        </Text>
        {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        {notice ? <Text accessibilityRole="text" style={{ color: colors.accent, lineHeight: 20 }}>{notice}</Text> : null}
        <PrimaryButton title="Verificar y guardar" onPress={() => void save()} loading={busy || saving} />
      </Card>
      <Card title="Captura e inferencia">
        <ChoiceRow label="Frecuencia de análisis" choices={fpsOptions} value={fps} onChange={setFps} />
        <ChoiceRow label="Rotación adicional" choices={rotationOptions} value={rotation} onChange={setRotation} />
        {runtimeConfig ? (
          <EdgeRuntime
            config={runtimeConfig}
            fps={Number(fps)}
            extraRotation={Number(rotation)}
            onStop={() => setRuntimeConfig(null)}
          />
        ) : (
          <Text style={{ color: colors.muted, lineHeight: 20 }}>
            Guarda una configuración válida para cargar y verificar los modelos, solicitar permiso de cámara e iniciar la outbox persistente.
          </Text>
        )}
      </Card>
    </Screen>
  );
}
