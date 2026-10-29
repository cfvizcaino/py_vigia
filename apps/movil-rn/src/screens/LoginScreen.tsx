import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { ErrorMessage, Field, PrimaryButton, Screen, SecondaryButton } from '../components/ui';
import { useSession } from '../state/session';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export function LoginScreen({ navigation }: Props) {
  const { login, exploreDemo, busy, error, baseUrl } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <Screen>
      <View style={{ paddingTop: 22, gap: 18 }}>
        <View style={{ width: 58, height: 58, backgroundColor: '#1F3A31', borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: colors.accent, fontSize: 26, fontWeight: '900' }}>V</Text>
        </View>
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.text, fontSize: 26, fontWeight: '800' }}>Consola del operador</Text>
          <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 22 }}>Accede a cámaras y consulta trayectorias estimadas.</Text>
        </View>
        <Field label="Correo electrónico" value={email} onChangeText={setEmail} keyboardType="email-address" placeholder="operador@ejemplo.org" />
        <Field label="Contraseña" value={password} onChangeText={setPassword} secureTextEntry placeholder="Contraseña" />
        {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        <PrimaryButton title="Iniciar sesión" onPress={() => void login(email, password)} loading={busy} />
        <SecondaryButton title="Explorar demo" onPress={exploreDemo} />
        <SecondaryButton title="Usar este teléfono como cámara" onPress={() => navigation.navigate('CameraMode')} />
        <SecondaryButton title="Edge autónomo (detección en el teléfono)" onPress={() => navigation.navigate('EdgeMode')} />
        <Text selectable style={{ color: colors.subtle, textAlign: 'center', fontSize: 12 }}>{baseUrl}</Text>
      </View>
    </Screen>
  );
}
