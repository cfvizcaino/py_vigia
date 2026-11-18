import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { BogotaDateTimeField } from '../components/BogotaDateTimeField';
import { LocationPicker } from '../components/LocationPicker';
import { Card, ChoiceRow, DemoBadge, ErrorMessage, Field, OptionSheet, PrimaryButton, SafetyBanner, Screen, SelectField } from '../components/ui';
import { bogotaDateTime, bogotaToUtc } from '../time/bogota';
import { activityLabel } from '../state/activity';
import { useSession } from '../state/session';
import { fonts, type } from '../theme/fonts';
import type { QueryInput } from '../types/models';
import type { TabParamList } from '../types/navigation';

type Props = BottomTabScreenProps<TabParamList, 'Query'>;

const COLORS = [
  { label: 'Blanco', value: 'white', dot: '#f4f4f4' },
  { label: 'Negro', value: 'black', dot: '#111111' },
  { label: 'Gris', value: 'gray', dot: '#8a8a8a' },
  { label: 'Rojo', value: 'red', dot: '#d83a3a' },
  { label: 'Azul', value: 'blue', dot: '#2f6fe0' },
  { label: 'Café', value: 'brown', dot: '#7a4a26' },
];

/** «C · Consulta (versión morada)»: C01–C07 del Figma. */
export function QueryScreen({ navigation }: Props) {
  const { devices, scenarios, isDemo, busy, error, search } = useSession();
  const now = new Date();
  const previousHour = new Date(now.getTime() - 60 * 60 * 1000);
  const [lat, setLat] = useState(String(devices[0]?.lat ?? 11.0131));
  const [lng, setLng] = useState(String(devices[0]?.lng ?? -74.8172));
  const [radius, setRadius] = useState('2000');
  const [date, setDate] = useState(() => bogotaDateTime(previousHour).slice(0, 10));
  const [from, setFrom] = useState(() => bogotaDateTime(previousHour).slice(11));
  const [to, setTo] = useState(() => bogotaDateTime(now).slice(11));
  const [vehicle, setVehicle] = useState('car');
  const [color, setColor] = useState('white');
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [scenarioId, setScenarioId] = useState('');
  const [point, setPoint] = useState<[number, number] | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [timeError, setTimeError] = useState(false);
  const [picker, setPicker] = useState<'camera' | 'scenario' | null>(null);

  const selectedCamera = devices.find((device) => device.id === selectedCameraId);
  const scenario = scenarios.find((item) => item.id === scenarioId);

  const chooseCamera = (id: string) => {
    setSelectedCameraId(id);
    const camera = devices.find((device) => device.id === id);
    if (camera) {
      setLat(String(camera.lat));
      setLng(String(camera.lng));
      setPoint([camera.lng, camera.lat]);
    }
  };

  const chooseScenario = (id: string) => {
    const item = scenarios.find((candidate) => candidate.id === id);
    if (!item) return;
    setScenarioId(id);
    const camera = devices.find((device) => device.external_id === item.camera_id);
    if (camera) {
      setLat(String(camera.lat)); setLng(String(camera.lng));
      setSelectedCameraId(camera.id); setPoint([camera.lng, camera.lat]);
    }
    setRadius(String(item.radius_m)); setDate(item.date); setFrom(item.time_from); setTo(item.time_to);
    setVehicle(item.vehicle_type ?? 'car'); setColor(item.color ?? 'white');
  };

  const run = async () => {
    const latitude = Number(lat);
    const longitude = Number(lng);
    const radiusM = Number(radius);
    setTimeError(false);
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
      if (to < from) timeTo = new Date(Date.parse(timeTo) + 24 * 60 * 60 * 1000).toISOString();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'Fecha u hora inválida.');
      return;
    }
    if (Date.parse(timeTo) <= Date.parse(timeFrom)) {
      setTimeError(true);
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
    <Screen tabs title={'Nueva\nconsulta'} right={isDemo ? <DemoBadge /> : null}>
      <Text style={[type(fonts.light, 11.5, 16, 0), { textAlign: 'center', opacity: 0.75 }]}>
        Define la cámara o el punto, el horario y las características. Los horarios se interpretan en America/Bogota (UTC−5).
      </Text>

      {scenarios.length ? (
        <Card title="Casos del dataset" icon="ms_science">
          <SelectField
            label="Caso de prueba"
            value={scenario ? `${scenario.id} · ${scenario.title}` : 'Elige un caso'}
            accessibilityLabel="Elegir caso del dataset"
            onPress={() => setPicker('scenario')}
          />
          <Text style={[type(fonts.light, 11, 15, 0), { opacity: 0.7 }]}>Llena cámara, fecha, horario, radio y filtros.</Text>
        </Card>
      ) : null}

      <Card title="Punto de búsqueda" icon="ms_location_on">
        {devices.length ? (
          <SelectField
            label="Cámara de referencia"
            value={selectedCamera ? `${selectedCamera.external_id} · ${selectedCamera.name}` : 'Punto manual en el mapa'}
            icon={selectedCamera ? 'ms_videocam' : 'ms_location_on'}
            onPress={() => setPicker('camera')}
          />
        ) : null}
        <LocationPicker
          devices={devices}
          height={176}
          point={point}
          showGpsButton={false}
          onChange={(coordinate) => {
            setPoint(coordinate);
            setSelectedCameraId('');
            setLng(String(coordinate[0]));
            setLat(String(coordinate[1]));
          }}
        />
        {!selectedCamera ? (
          <Text style={[type(fonts.light, 11, 15, 0), { opacity: 0.7 }]}>Mantén pulsado el mapa para mover el punto. Las cámaras dentro del radio se usan como inicio.</Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Field label="Latitud" value={lat} onChangeText={setLat} keyboardType="numeric" /></View>
          <View style={{ flex: 1 }}><Field label="Longitud" value={lng} onChangeText={setLng} keyboardType="numeric" /></View>
        </View>
        <Field label="Radio" value={radius} onChangeText={setRadius} keyboardType="numeric" icon="ms_straighten" suffix="metros" />
      </Card>

      <Card title="Ventana temporal" icon="ms_schedule">
        <Text style={[type(fonts.light, 11, 14, 0), { opacity: 0.7 }]}>Hora de Colombia (UTC−5)</Text>
        <BogotaDateTimeField label="Fecha" mode="date" date={date} onChange={setDate} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <BogotaDateTimeField label="Desde" mode="time" date={date} time={from} onChange={(value) => { setFrom(value); setTimeError(false); }} />
          <BogotaDateTimeField label="Hasta" mode="time" date={date} time={to} error={timeError} onChange={(value) => { setTo(value); setTimeError(false); }} />
        </View>
        {timeError ? <ErrorMessage>La hora final debe ser posterior a la hora inicial.</ErrorMessage> : null}
      </Card>

      <Card title="Vehículo y apariencia" icon="ms_directions_car">
        <ChoiceRow label="Tipo" value={vehicle} onChange={setVehicle} grow choices={[{ label: 'Automóvil', value: 'car', icon: 'ms_directions_car' }, { label: 'Motocicleta', value: 'motorcycle', icon: 'ms_two_wheeler' }]} />
        <ChoiceRow label="Color" value={color} onChange={setColor} choices={COLORS} />
      </Card>

      <SafetyBanner />
      {formError && !timeError ? <ErrorMessage>{formError}</ErrorMessage> : null}
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      <PrimaryButton title={busy ? 'Consultando…' : 'Consultar trayectorias'} accessibilityLabel="Consultar trayectorias" icon={busy ? undefined : 'ms_travel_explore'} onPress={() => void run()} loading={busy} />

      <OptionSheet
        visible={picker === 'camera'}
        title="Cámara de referencia"
        value={selectedCameraId}
        onClose={() => setPicker(null)}
        onSelect={chooseCamera}
        options={[
          { value: '', label: 'Punto manual', detail: 'Elegir el punto en el mapa', icon: 'ms_location_on' },
          ...devices.map((device) => ({
            value: device.id,
            label: `${device.external_id} · ${device.name}`,
            detail: activityLabel(device).label,
            icon: 'ms_videocam' as const,
          })),
        ]}
      />
      <OptionSheet
        visible={picker === 'scenario'}
        title="Caso de prueba"
        value={scenarioId}
        onClose={() => setPicker(null)}
        onSelect={chooseScenario}
        options={scenarios.map((item) => ({ value: item.id, label: `${item.id} · ${item.title}`, icon: 'ms_science' as const }))}
      />
    </Screen>
  );
}
