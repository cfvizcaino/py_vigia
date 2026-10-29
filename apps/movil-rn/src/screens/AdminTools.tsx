import { useState } from 'react';
import { Text } from 'react-native';

import { CameraMap } from '../components/CameraMap';
import { Card, ChoiceRow, ErrorMessage, Field, PrimaryButton, SecondaryButton } from '../components/ui';
import { ApiError } from '../api/client';
import { useSession } from '../state/session';
import { colors } from '../theme/colors';
import type { DeviceDetection, EdgeCredential, IssuedCredential } from '../types/models';

export function AdminTools() {
  const {
    devices, createEdge, relocateEdge, recentDetections, issueCredential,
    listCredentials, revokeCredential,
  } = useSession();
  const [cameraId, setCameraId] = useState('');
  const [name, setName] = useState('');
  const [cameraModel, setCameraModel] = useState('');
  const [lat, setLat] = useState(devices[0] ? String(devices[0].lat) : '11.0131');
  const [lng, setLng] = useState(devices[0] ? String(devices[0].lng) : '-74.8172');
  const [selectedDeviceId, setSelectedDeviceId] = useState(devices[0]?.id ?? '');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detections, setDetections] = useState<DeviceDetection[]>([]);
  const [credentials, setCredentials] = useState<EdgeCredential[]>([]);
  const [issued, setIssued] = useState<IssuedCredential | null>(null);

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

  const readCoordinates = (): [number, number] | null => {
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      setError('Ingresa coordenadas válidas antes de guardar.');
      return null;
    }
    return [latitude, longitude];
  };

  return (
    <>
      <Card title="Registrar edge">
        <Field label="Identificador de cámara" value={cameraId} onChangeText={setCameraId} placeholder="CAM-05" autoCapitalize="characters" />
        <Field label="Nombre" value={name} onChangeText={setName} placeholder="Calle 84" />
        <Field label="Modelo de cámara (opcional)" value={cameraModel} onChangeText={setCameraModel} placeholder="Marca y modelo" />
        <Field label="Latitud" value={lat} onChangeText={setLat} keyboardType="numeric" />
        <Field label="Longitud" value={lng} onChangeText={setLng} keyboardType="numeric" />
        <CameraMap
          devices={devices}
          height={190}
          point={[Number(lng), Number(lat)]}
          onSelectPoint={(coordinate) => {
            setLng(String(coordinate[0]));
            setLat(String(coordinate[1]));
          }}
        />
        <Text style={{ color: colors.subtle, fontSize: 12 }}>Mantén pulsado el mapa o usa GPS para ubicar la cámara.</Text>
        <PrimaryButton title="Registrar cámara" loading={busy} onPress={() => void run(async () => {
          const point = readCoordinates();
          if (!cameraId.trim() || !name.trim() || !point) {
            if (!cameraId.trim() || !name.trim()) setError('Identificador y nombre son obligatorios.');
            return;
          }
          await createEdge({
            cameraId: cameraId.trim(),
            name: name.trim(),
            lat: point[0],
            lng: point[1],
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
            onChange={(id) => setSelectedDeviceId(id)}
            choices={devices.map((device) => ({ label: device.external_id, value: device.id }))}
          />
        ) : <Text style={{ color: colors.muted }}>Registra una cámara para administrar su ubicación.</Text>}
        <Field label="Nueva latitud" value={lat} onChangeText={setLat} keyboardType="numeric" />
        <Field label="Nueva longitud" value={lng} onChangeText={setLng} keyboardType="numeric" />
        <PrimaryButton title="Guardar ubicación" loading={busy} disabled={!selectedDeviceId} onPress={() => void run(async () => {
          const point = readCoordinates();
          if (!point) return;
          await relocateEdge(selectedDeviceId, point[0], point[1]);
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
        {credentials.map((credential) => (
          <Card key={credential.id}>
            <Text style={{ color: colors.text }}>{credential.camera_id} · vence {new Date(credential.expires_at).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}</Text>
            <Text style={{ color: credential.revoked ? colors.danger : colors.success }}>{credential.revoked ? 'Revocada' : 'Activa'}</Text>
            {!credential.revoked ? <SecondaryButton title="Revocar credencial" onPress={() => void run(async () => {
              await revokeCredential(credential.id);
              setCredentials((items) => items.map((item) => item.id === credential.id ? { ...item, revoked: true } : item));
              setNotice('Credencial revocada.');
            })} /> : null}
          </Card>
        ))}
      </Card>
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      {notice ? <Text accessibilityRole="alert" style={{ color: colors.success }}>{notice}</Text> : null}
    </>
  );
}
