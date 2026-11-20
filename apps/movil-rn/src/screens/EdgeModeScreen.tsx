import { useCallback, useEffect, useState } from 'react';
import { Text } from 'react-native';

import { Icon } from '../components/Icon';
import { Card, ChoiceRow, ErrorMessage, Field, Notice, PrimaryButton, Screen } from '../components/ui';
import {
  loadEdgeConfiguration,
  readEdgeConfiguration,
  saveEdgeConfiguration,
  validateEdgeServerUrl,
  verifyEdgeToken,
} from '../edge/config';
import type { EdgeConfiguration } from '../edge/config';
import type { RejectedStatus } from '../edge/unauthorized';
import { EdgeRuntime } from './EdgeRuntime';
import { fonts, type } from '../theme/fonts';

const fpsOptions = [
  { label: '5/s', value: '5' },
  { label: '8/s', value: '8' },
  { label: '12/s', value: '12' },
  { label: '15/s', value: '15' },
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
        console.error('No fue posible leer la configuración Edge.', reason);
        if (active) setError('No fue posible leer la configuración Edge.');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const save = async () => {
    const cleanCameraId = cameraId.trim();
    const cleanServerUrl = serverUrl.trim().replace(/\/+$/, '');
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(cleanCameraId)) {
      setError('El identificador de cámara solo puede contener letras, números, punto, guion y guion bajo.');
      return;
    }
    const urlIssue = validateEdgeServerUrl(cleanServerUrl);
    if (urlIssue) {
      setError(urlIssue);
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const previous = await readEdgeConfiguration();
      const cleanToken = token.trim() || previous?.token || '';
      if (!cleanToken) {
        setError('Ingresa el token de edge emitido por un administrador.');
        return;
      }
      const configuration = { cameraId: cleanCameraId, serverUrl: cleanServerUrl, token: cleanToken };
      await verifyEdgeToken(configuration);
      await saveEdgeConfiguration(configuration);
      setRuntimeConfig(configuration);
      setHasToken(true);
      setToken('');
      setNotice('Token verificado mediante un envelope vacío y configuración guardada de forma segura.');
    } catch (reason) {
      console.error('No fue posible verificar o guardar la configuración Edge.', reason);
      setError('No fue posible verificar o guardar la configuración Edge. Revisa el servidor y el registro.');
    } finally {
      setSaving(false);
    }
  };

  const handleUnauthorized = useCallback((status: RejectedStatus) => {
    setRuntimeConfig(null);
    if (status === 403) {
      // The token is still stored: fixing the camera id is enough.
      setError('El token pertenece a otra cámara. Revisa el identificador de cámara y vuelve a iniciar.');
      return;
    }
    setHasToken(false);
    setToken('');
    setError('Este nodo fue eliminado o su token venció o fue revocado. Pide a un administrador un token nuevo.');
  }, []);

  if (runtimeConfig) {
    return (
      <Screen back={() => setRuntimeConfig(null)} title={'Edge\nautónomo'}>
        <Text style={[type(fonts.medium, 12), { textAlign: 'center', opacity: 0.85 }]}>{runtimeConfig.cameraId} · {runtimeConfig.serverUrl.replace(/^https?:\/\//, '')}</Text>
        <EdgeRuntime
          config={runtimeConfig}
          fps={Number(fps)}
          extraRotation={Number(rotation)}
          onStop={() => setRuntimeConfig(null)}
          onUnauthorized={handleUnauthorized}
        />
        <Card title="Ajustes" icon="ms_speed">
          <ChoiceRow label="Frecuencia de análisis" choices={fpsOptions} value={fps} onChange={setFps} grow />
          <Text style={[type(fonts.light, 10.5, 14, 0), { opacity: 0.6 }]}>Menos análisis por segundo ahorra batería y temperatura.</Text>
        </Card>
        <Notice>Mantén la app abierta y el teléfono conectado al cargador.</Notice>
      </Screen>
    );
  }

  return (
    <Screen back title={'Edge\nautónomo'}>
      <Text style={[type(fonts.light, 11.5, 16, 0), { textAlign: 'center', opacity: 0.75 }]}>
        Configura este teléfono como un edge completo: detecta vehículos con los modelos TFLite integrados y publica eventos firmados, sin PC. Los frames de cámara no se transmiten al centro.
      </Text>
      <Notice tone="accent">Un administrador registra la cámara en «Agregar edge» y te entrega el token.</Notice>
      <Card title="Configuración del edge" icon="ms_memory">
        <Field label="Identificador de cámara" value={cameraId} onChangeText={setCameraId} placeholder="CEL-01" autoCapitalize="characters" icon="ms_videocam" />
        <Field label="URL del backend" value={serverUrl} onChangeText={setServerUrl} placeholder="https://vigia.ejemplo.org" keyboardType="url" icon="ms_link" />
        <Field
          label={hasToken ? 'Token edge (dejar vacío para conservarlo)' : 'Token edge'}
          value={token}
          onChangeText={setToken}
          placeholder={hasToken ? 'Token guardado en Keychain/Keystore' : 'Token emitido por administración'}
          secureTextEntry
          autoCapitalize="none"
          icon="ms_key"
          trailing={<Icon name="ms_visibility_off" size={20} color="rgba(227,227,227,0.8)" />}
        />
        <Text style={[type(fonts.light, 10.5, 14, 0), { opacity: 0.6 }]}>
          El token se guarda cifrado en Keychain/Keystore y nunca se muestra de nuevo. HTTP se admite solo en redes locales.
        </Text>
        {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        {notice ? <Notice tone="ok" icon="ms_check_circle">{notice}</Notice> : null}
        <PrimaryButton title="Verificar y guardar" icon="ms_check" onPress={() => void save()} loading={busy || saving} />
      </Card>
      <Card title="Captura e inferencia" icon="ms_speed">
        <ChoiceRow label="Frecuencia de análisis" choices={fpsOptions} value={fps} onChange={setFps} grow />
        <ChoiceRow label="Rotación adicional" choices={rotationOptions} value={rotation} onChange={setRotation} grow />
        <Text style={[type(fonts.light, 11, 15, 0), { opacity: 0.7 }]}>
          Guarda una configuración válida para cargar y verificar los modelos, solicitar permiso de cámara e iniciar la outbox persistente.
        </Text>
      </Card>
    </Screen>
  );
}
