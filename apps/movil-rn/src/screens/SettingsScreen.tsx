import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';
import { Card, DemoBadge, ErrorMessage, Field, Glass, Notice, PrimaryButton, Screen, SecondaryButton } from '../components/ui';
import { useSession } from '../state/session';
import { colors } from '../theme/colors';
import { fonts, type } from '../theme/fonts';
import type { RootStackParamList, TabParamList } from '../types/navigation';

type Props = BottomTabScreenProps<TabParamList, 'Settings'>;

/** «D · Ajustes (versión morada)»: D06, D06b (guardada), D06c (inválida) y D07 (demostración). */
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
    <Screen tabs title={'Ajustes\ny sesión'} right={isDemo ? <DemoBadge /> : null}>
      {isDemo ? (
        <Notice tone="accent" icon="ms_science">Estás en modo demostración. Las consultas no se envían al backend.</Notice>
      ) : (
        <Card title="Servidor central" icon="ms_dns">
          <Text style={[type(fonts.light, 11, 16, 0), { opacity: 0.75 }]}>
            La dirección se guarda en este dispositivo. El token de sesión solo se guarda en Keychain/Keystore.
          </Text>
          <Field label="URL base del backend" value={url} onChangeText={(value) => { setUrl(value); setError(null); setNotice(null); }} keyboardType="url" placeholder="https://api.ejemplo.org" icon="ms_link" error={Boolean(error)} />
          {error ? <ErrorMessage>{error}</ErrorMessage> : notice ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="ms_check_circle" size={16} color={colors.success} />
              <Text style={[type(fonts.regular, 12.5, 17, 0), { color: colors.success }]}>{notice}</Text>
            </View>
          ) : (
            <Text style={[type(fonts.light, 10.5, 14, 0), { opacity: 0.6 }]}>
              HTTP solo se permite para localhost y emuladores de desarrollo; los demás servidores deben usar HTTPS.
            </Text>
          )}
          <PrimaryButton title="Guardar URL" onPress={() => void save()} />
        </Card>
      )}
      {sessionError ? <ErrorMessage>{sessionError}</ErrorMessage> : null}
      <View style={{ gap: 8 }}>
        <SettingsRow icon="ms_lock" title="Sesión protegida" detail={isDemo ? 'Sesión de demostración · sin servidor' : `${user?.display_name ?? 'Operador'} · ${user?.role === 'admin' ? 'administrador' : 'operador'}. El token no se guarda en preferencias ni registros.`} />
        <SettingsRow icon="ms_videocam" title="Modo cámara" detail="Convertir este teléfono en la cámara de un edge" onPress={() => navigation.navigate('CameraMode')} />
        <SettingsRow icon="ms_memory" title="Edge autónomo" detail="Detectar vehículos en este teléfono, sin PC" onPress={() => navigation.navigate('EdgeMode')} />
        <SettingsRow icon="ms_schedule" title="Zona horaria de operación" detail="America/Bogota (UTC−5)" />
      </View>
      <SecondaryButton title={isDemo ? 'Salir de la demostración' : 'Cerrar sesión'} icon="ms_logout" onPress={() => void logout()} />
    </Screen>
  );
}

function SettingsRow({ icon, title, detail, onPress }: { icon: IconName; title: string; detail: string; onPress?: () => void }) {
  const row = (
    <Glass variant="tile" radius={16} style={styles.row}>
      <View style={styles.iconBox}><Icon name={icon} size={20} color="#ffffff" /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={type(fonts.regular, 14, 17)}>{title}</Text>
        <Text style={[type(fonts.light, 11, 15, 0), { opacity: 0.7 }]}>{detail}</Text>
      </View>
      {onPress ? <Icon name="ms_chevron_right" size={22} color={colors.icon} /> : null}
    </Glass>
  );
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}>{row}</Pressable> : row;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 14 },
  iconBox: { padding: 8, borderRadius: 12, backgroundColor: 'rgba(157,118,248,0.22)' },
});
