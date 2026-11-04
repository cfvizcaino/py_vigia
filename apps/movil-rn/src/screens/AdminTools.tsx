import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { LocationPicker } from '../components/LocationPicker';
import { Card, ChoiceRow, ErrorMessage, Field, PrimaryButton, SecondaryButton } from '../components/ui';
import { ApiError } from '../api/client';
import { useSession } from '../state/session';
import { colors } from '../theme/colors';
import type { DeviceDetection, EdgeCredential, IssuedCredential } from '../types/models';

const cameraIdPattern = /^[A-Z0-9][A-Z0-9-]{1,63}$/;

export function AdminTools() {
  const {
    devices, createEdge, relocateEdge, recentDetections, issueCredential,
    listCredentials, revokeCredential,
  } = useSession();
  const [cameraId, setCameraId] = useState('');
  const [name, setName] = useState('');
  const [cameraModel, setCameraModel] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState(devices[0]?.id ?? '');
  const [addPoint, setAddPoint] = useState<[number, number]>(devices[0] ? [devices[0].lng, devices[0].lat] : [-74.8172, 11.0131]);
  const [movePoint, setMovePoint] = useState<[number, number]>(devices[0] ? [devices[0].lng, devices[0].lat] : [-74.8172, 11.0131]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detections, setDetections] = useState<DeviceDetection[]>([]);
  const [credentials, setCredentials] = useState<EdgeCredential[]>([]);
  const [issued, setIssued] = useState<IssuedCredential | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const refresh = () => setNow(Date.now());
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'No fue posible completar la acción administrativa.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card title="Agregar edge">
        <Field label="Identificador de cámara" value={cameraId} onChangeText={setCameraId} placeholder="CEL-01" autoCapitalize="characters" />
        <Field label="Nombre" value={name} onChangeText={setName} placeholder="Calle 84" />
        <Field label="Modelo de cámara (opcional)" value={cameraModel} onChangeText={setCameraModel} placeholder="Marca y modelo" />
        <Text style={{ color: colors.muted }}>Ubicación de la cámara</Text>
        <LocationPicker
          devices={devices}
          height={190}
          point={addPoint}
          onChange={setAddPoint}
        />
        <PrimaryButton title="Registrar cámara" loading={busy} onPress={() => void run(async () => {
          const cleanId = cameraId.trim();
          const existingId = devices.some((device) => device.external_id === cleanId);
          if (!cameraIdPattern.test(cleanId)) {
            setError('Usa mayúsculas, números y guiones (p. ej. CEL-02).');
            return;
          }
          if (existingId) {
            setError('Ya existe una cámara con ese identificador.');
            return;
          }
          if (!name.trim()) {
            setError('Escribe un nombre para reconocerla.');
            return;
          }
          await createEdge({
            cameraId: cleanId,
            name: name.trim(),
            lat: addPoint[1],
            lng: addPoint[0],
            ...(cameraModel.trim() ? { cameraModel: cameraModel.trim() } : {}),
          });
          setNotice('Edge registrado. Quedará sin conexión hasta recibir su primer evento.');
          setCameraId('');
          setName('');
          setCameraModel('');
        })} />
      </Card>

      <Card title="Mover edge y revisar detecciones">
        {devices.length ? (
          <ChoiceRow
            label="Cámara"
            value={selectedDeviceId}
            onChange={(id) => {
              setSelectedDeviceId(id);
              const selected = devices.find((device) => device.id === id);
              if (selected) setMovePoint([selected.lng, selected.lat]);
            }}
            choices={devices.map((device) => ({ label: device.external_id, value: device.id }))}
          />
        ) : <Text style={{ color: colors.muted }}>Registra una cámara para administrar su ubicación.</Text>}
        <Text style={{ color: colors.muted }}>Nueva ubicación</Text>
        <LocationPicker devices={devices} height={190} point={movePoint} onChange={setMovePoint} />
        <PrimaryButton title="Guardar ubicación" loading={busy} disabled={!selectedDeviceId} onPress={() => void run(async () => {
          await relocateEdge(selectedDeviceId, movePoint[1], movePoint[0]);
          setNotice('Ubicación actualizada. Los enlaces viales deberán sincronizarse de nuevo.');
        })} />
        <SecondaryButton title="Ver detecciones recientes" disabled={!selectedDeviceId} onPress={() => void run(async () => {
          setDetections(await recentDetections(selectedDeviceId));
        })} />
        {detections.map((detection) => (
          <Text key={detection.id} style={{ color: colors.muted }}>
            {new Date(detection.observed_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' })} · {detection.vehicle_type} · {detection.direction} · {Math.round(detection.confidence * 100)}%
          </Text>
        ))}
        {!detections.length ? <Text style={{ color: colors.subtle }}>Carga detecciones para ver actividad de la cámara.</Text> : null}
      </Card>

      <Card title="Credenciales de edge">
        {devices.length ? (
          <ChoiceRow
            label="Cámara a autenticar"
            value={devices.find((device) => device.external_id === cameraId)?.id ?? selectedDeviceId}
            onChange={(id) => {
              const device = devices.find((item) => item.id === id);
              if (device) setCameraId(device.external_id);
              setSelectedDeviceId(id);
            }}
            choices={devices.map((device) => ({ label: device.external_id, value: device.id }))}
          />
        ) : null}
        <PrimaryButton title="Emitir credencial · 90 días" loading={busy} disabled={!devices.length} onPress={() => void run(async () => {
          const selected = devices.find((device) => device.id === selectedDeviceId);
          if (!selected) {
            setError('Selecciona una cámara registrada.');
            return;
          }
          setIssued(await issueCredential(selected.external_id));
          setCredentials(await listCredentials());
          setNotice('Secreto emitido una sola vez; cópialo antes de salir de esta pantalla.');
        })} />
        {issued ? (
          <Card title="Secreto visible una sola vez">
            <Text selectable style={{ color: colors.warning, fontFamily: 'monospace' }}>{issued.secret}</Text>
            <Text style={{ color: colors.subtle }}>No cierres esta pantalla hasta haberlo copiado. No se guarda en el dispositivo.</Text>
          </Card>
        ) : null}
        <SecondaryButton title="Actualizar lista de credenciales" onPress={() => void run(async () => {
          setCredentials(await listCredentials());
        })} />
        {credentials.map((credential) => {
          const expired = Date.parse(credential.expires_at) <= now;
          const status = credential.revoked ? 'Revocada' : expired ? 'Vencida' : 'Activa';
          return (
            <Card key={credential.id}>
              <Text style={{ color: colors.text }}>{credential.camera_id} · vence {new Date(credential.expires_at).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}</Text>
              <Text style={{ color: credential.revoked ? colors.danger : expired ? colors.warning : colors.success }}>{status}</Text>
              {!credential.revoked && !expired ? <SecondaryButton title="Revocar credencial" onPress={() => void run(async () => {
                await revokeCredential(credential.id);
                setCredentials((items) => items.map((item) => item.id === credential.id ? { ...item, revoked: true } : item));
                setNotice('Credencial revocada.');
              })} /> : null}
            </Card>
          );
        })}
      </Card>
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      {notice ? <Text accessibilityRole="alert" style={{ color: colors.success }}>{notice}</Text> : null}
    </>
  );
}
