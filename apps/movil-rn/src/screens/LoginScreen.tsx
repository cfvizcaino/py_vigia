import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
<<<<<<< HEAD
import { Modal, Text, View } from 'react-native';
=======
import { Text, View } from 'react-native';
>>>>>>> df0453cade982a2911157addaf8931f9efe04285

import { ErrorMessage, Field, PrimaryButton, Screen, SecondaryButton } from '../components/ui';
import { useSession } from '../state/session';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export function LoginScreen({ navigation }: Props) {
<<<<<<< HEAD
  const { login, exploreDemo, saveApiUrl, busy, error, baseUrl } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [urlDialogVisible, setUrlDialogVisible] = useState(false);
  const [url, setUrl] = useState(baseUrl);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [savingUrl, setSavingUrl] = useState(false);

  const submit = async () => {
    const cleanEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setFormError('Ingresa un correo válido.');
      return;
    }
    if (!password) {
      setFormError('Ingresa tu contraseña.');
      return;
    }
    setFormError(null);
    await login(cleanEmail, password);
  };

  const persistUrl = async () => {
    setSavingUrl(true);
    setUrlError(null);
    try {
      const issue = await saveApiUrl(url);
      if (issue) {
        setUrlError(issue);
        return;
      }
      setUrlDialogVisible(false);
    } catch (reason) {
      setUrlError(reason instanceof Error ? reason.message : 'No fue posible guardar la URL.');
    } finally {
      setSavingUrl(false);
    }
  };
=======
  const { login, exploreDemo, busy, error, baseUrl } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
>>>>>>> df0453cade982a2911157addaf8931f9efe04285

  return (
    <Screen>
      <View style={{ paddingTop: 22, gap: 18 }}>
<<<<<<< HEAD
        <SecondaryButton title="Configurar URL del servidor" onPress={() => {
          setUrl(baseUrl);
          setUrlError(null);
          setUrlDialogVisible(true);
        }} />
=======
>>>>>>> df0453cade982a2911157addaf8931f9efe04285
        <View style={{ width: 58, height: 58, backgroundColor: '#1F3A31', borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: colors.accent, fontSize: 26, fontWeight: '900' }}>V</Text>
        </View>
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.text, fontSize: 26, fontWeight: '800' }}>Consola del operador</Text>
          <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 22 }}>Accede a cámaras y consulta trayectorias estimadas.</Text>
        </View>
        <Field label="Correo electrónico" value={email} onChangeText={setEmail} keyboardType="email-address" placeholder="operador@ejemplo.org" />
<<<<<<< HEAD
        <Field label="Contraseña" value={password} onChangeText={setPassword} secureTextEntry={!passwordVisible} placeholder="Contraseña" />
        <SecondaryButton title={passwordVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'} onPress={() => setPasswordVisible((visible) => !visible)} />
        {formError ? <ErrorMessage>{formError}</ErrorMessage> : null}
        {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        <PrimaryButton title="Iniciar sesión" onPress={() => void submit()} loading={busy} />
=======
        <Field label="Contraseña" value={password} onChangeText={setPassword} secureTextEntry placeholder="Contraseña" />
        {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        <PrimaryButton title="Iniciar sesión" onPress={() => void login(email, password)} loading={busy} />
>>>>>>> df0453cade982a2911157addaf8931f9efe04285
        <SecondaryButton title="Explorar demo" onPress={exploreDemo} />
        <SecondaryButton title="Usar este teléfono como cámara" onPress={() => navigation.navigate('CameraMode')} />
        <SecondaryButton title="Edge autónomo (detección en el teléfono)" onPress={() => navigation.navigate('EdgeMode')} />
        <Text selectable style={{ color: colors.subtle, textAlign: 'center', fontSize: 12 }}>{baseUrl}</Text>
      </View>
<<<<<<< HEAD
      <Modal animationType="fade" onRequestClose={() => setUrlDialogVisible(false)} transparent visible={urlDialogVisible}>
        <View style={{ flex: 1, justifyContent: 'center', padding: 22, backgroundColor: '#000B' }}>
          <View style={{ backgroundColor: colors.background, borderRadius: 12, padding: 20, gap: 14 }}>
            <Text style={{ color: colors.text, fontSize: 19, fontWeight: '700' }}>URL del backend</Text>
            <Field label="Dirección del servidor" value={url} onChangeText={setUrl} keyboardType="url" placeholder="https://servidor.vigia" />
            <Text style={{ color: colors.subtle, fontSize: 12 }}>Emulador Android: http://10.0.2.2:8000. HTTP solo se permite en localhost y redes locales.</Text>
            {urlError ? <ErrorMessage>{urlError}</ErrorMessage> : null}
            <PrimaryButton title="Guardar" onPress={() => void persistUrl()} loading={savingUrl} />
            <SecondaryButton title="Cancelar" onPress={() => setUrlDialogVisible(false)} disabled={savingUrl} />
          </View>
        </View>
      </Modal>
=======
>>>>>>> df0453cade982a2911157addaf8931f9efe04285
    </Screen>
  );
}
