import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useState } from 'react';
import { Text } from 'react-native';

import { CameraMap } from '../components/CameraMap';
import { ChoiceRow, DemoBadge, ErrorMessage, Field, PrimaryButton, Screen } from '../components/ui';
import { bogotaDateTime, bogotaToUtc } from '../time/bogota';
import { useSession } from '../state/session';
import { colors } from '../theme/colors';
import type { QueryInput } from '../types/models';
import type { TabParamList } from '../types/navigation';

type Props = BottomTabScreenProps<TabParamList, 'Query'>;

export function QueryScreen({ navigation }: Props) {
  const { devices, scenarios, isDemo, busy, error, search } = useSession();
  const [lat, setLat] = useState(String(devices[0]?.lat ?? 11.0131));
  const [lng, setLng] = useState(String(devices[0]?.lng ?? -74.8172));
  const [radius, setRadius] = useState('2000');
  const [date, setDate] = useState(() => bogotaDateTime(new Date()).slice(0, 10));
  const [from, setFrom] = useState(() => bogotaDateTime(new Date(Date.now() - 60 * 60 * 1000)).slice(11));
  const [to, setTo] = useState(() => bogotaDateTime(new Date()).slice(11));
  const [vehicle, setVehicle] = useState('car');
  const [color, setColor] = useState('white');
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [point, setPoint] = useState<[number, number] | undefined>();
  const [formError, setFormError] = useState<string | null>(null);

  const run = async () => {
    const latitude = Number(lat);
    const longitude = Number(lng);
    const radiusM = Number(radius);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      setFormError('Ingresa una latitud entre −90 y 90 y una longitud entre −180 y 180.');
      return;
    }
    if (!Number.isInteger(radiusM) || radiusM < 1 || radiusM > 100_000) {
      setFormError('El radio debe ser un número entero entre 1 y 100.000 metros.');
      return;
    }
    let timeFrom: string;
    let timeTo: string;
    try {
      timeFrom = bogotaToUtc(date, from);
      timeTo = bogotaToUtc(date, to);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'Fecha u hora inválida.');
      return;
    }
    if (Date.parse(timeTo) <= Date.parse(timeFrom)) {
      setFormError('La hora final debe ser posterior a la hora inicial.');
      return;
    }
    setFormError(null);
    const input: QueryInput = {
      lat: latitude,
      lng: longitude,
      radius_m: radiusM,
      time_from: timeFrom,
      time_to: timeTo,
      vehicle_type: vehicle,
      color,
    };
    if (await search(input)) navigation.navigate('Results');
  };

  return (
    <Screen>
      {isDemo ? <DemoBadge /> : null}
      <Text style={{ color: colors.muted, lineHeight: 21 }}>Define la cámara o el punto, el horario y las características. Los horarios se interpretan en America/Bogota (UTC−5).</Text>
      {devices.length ? (
        <ChoiceRow
          label="Punto de búsqueda"
          value={selectedCameraId}
          onChange={(id) => {
            setSelectedCameraId(id);
            const camera = devices.find((device) => device.id === id);
            if (camera) {
              setLat(String(camera.lat));
              setLng(String(camera.lng));
              setPoint([camera.lng, camera.lat]);
            }
          }}
          choices={[{ label: 'Punto manual', value: '' }, ...devices.map((device) => ({ label: device.external_id, value: device.id }))]}
        />
      ) : null}
      <CameraMap
        devices={devices}
        height={240}
        point={point}
        center={point}
        onSelectPoint={(coordinate) => {
          setPoint(coordinate);
          setSelectedCameraId('');
          setLng(String(coordinate[0]));
          setLat(String(coordinate[1]));
        }}
      />
      {scenarios.length ? (
        <ChoiceRow label="Casos del dataset" value="" onChange={(id) => {
          const scenario = scenarios.find((item) => item.id === id);
          if (!scenario) return;
          const camera = devices.find((device) => device.external_id === scenario.camera_id);
          if (camera) {
            setLat(String(camera.lat)); setLng(String(camera.lng));
            setSelectedCameraId(camera.id); setPoint([camera.lng, camera.lat]);
          }
          setRadius(String(scenario.radius_m)); setDate(scenario.date); setFrom(scenario.time_from); setTo(scenario.time_to);
          setVehicle(scenario.vehicle_type ?? 'car'); setColor(scenario.color ?? 'white');
        }} choices={scenarios.map((scenario) => ({ label: `${scenario.id} · ${scenario.title}`, value: scenario.id }))} />
      ) : null}
      <Field label="Latitud" value={lat} onChangeText={setLat} keyboardType="numeric" />
      <Field label="Longitud" value={lng} onChangeText={setLng} keyboardType="numeric" />
      <Field label="Radio (m)" value={radius} onChangeText={setRadius} keyboardType="numeric" />
      <Field label="Fecha (AAAA-MM-DD)" value={date} onChangeText={setDate} placeholder="2026-10-28" />
      <Field label="Desde (hora Bogotá)" value={from} onChangeText={setFrom} placeholder="14:20" />
      <Field label="Hasta (hora Bogotá)" value={to} onChangeText={setTo} placeholder="15:30" />
      <ChoiceRow label="Tipo" value={vehicle} onChange={setVehicle} choices={[{ label: 'Automóvil', value: 'car' }, { label: 'Motocicleta', value: 'motorcycle' }]} />
      <ChoiceRow label="Color" value={color} onChange={setColor} choices={[{ label: 'Blanco', value: 'white' }, { label: 'Negro', value: 'black' }, { label: 'Gris', value: 'gray' }, { label: 'Rojo', value: 'red' }, { label: 'Azul', value: 'blue' }, { label: 'Café', value: 'brown' }]} />
      {formError ? <ErrorMessage>{formError}</ErrorMessage> : null}
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      <PrimaryButton title="Consultar trayectorias" onPress={() => void run()} loading={busy} />
    </Screen>
  );
}
