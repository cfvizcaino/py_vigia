import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useState } from 'react';
import { Text } from 'react-native';

import { Card, DemoBadge, ErrorMessage, Field, PrimaryButton, Screen, SecondaryButton } from '../components/ui';
import { useSession } from '../state/session';
import { colors } from '../theme/colors';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList, TabParamList } from '../types/navigation';

type Props = BottomTabScreenProps<TabParamList, 'Settings'>;

export function SettingsScreen(_props: Props) {
  const { baseUrl, saveApiUrl, logout, isDemo, user, error: sessionError } = useSession();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [url, setUrl] = useState(baseUrl);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    setNotice(null);
    try {
      const issue = await saveApiUrl(url);
      if (issue) setError(issue);
      else setNotice('URL del backend guardada.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No fue posible guardar la URL.');
    }
  };

  return (
    <Screen>
      {isDemo ? <DemoBadge /> : null}
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>Servidor central</Text>
      <Text style={{ color: colors.muted, lineHeight: 21 }}>La dirección se guarda en este dispositivo. El token de sesión solo se almacena en Keychain/Keystore.</Text>
      <Field label="URL base del backend" value={url} onChangeText={setUrl} keyboardType="url" placeholder="https://api.ejemplo.org" />
      <Text style={{ color: colors.warning, fontSize: 12 }}>HTTP solo se permite para localhost y emuladores de desarrollo; los demás servidores deben usar HTTPS.</Text>
      {sessionError ? <ErrorMessage>{sessionError}</ErrorMessage> : null}
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      {notice ? <Text style={{ color: colors.accent }}>{notice}</Text> : null}
      <PrimaryButton title="Guardar URL" onPress={() => void save()} />
      <Card title="Sesión protegida">
        <Text style={{ color: colors.muted }}>{user?.display_name} · {user?.role}</Text>
        <Text style={{ color: colors.muted }}>El token no se guarda en preferencias ni en archivos de registro.</Text>
      </Card>
      {isDemo ? <Card><Text style={{ color: colors.warning }}>Estás en modo demostración. Las consultas no se envían al backend.</Text></Card> : null}
      <SecondaryButton title="Modo cámara" onPress={() => navigation.navigate('CameraMode')} />
      <SecondaryButton title="Edge autónomo" onPress={() => navigation.navigate('EdgeMode')} />
      <Card title="Zona horaria de operación"><Text style={{ color: colors.muted }}>America/Bogota (UTC−5)</Text></Card>
      <SecondaryButton title="Cerrar sesión" onPress={() => void logout()} />
    </Screen>
  );
}
