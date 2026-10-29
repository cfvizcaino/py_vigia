import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { ErrorMessage, Field, PrimaryButton, Screen, SecondaryButton } from '../components/ui';
import { useSession } from '../state/session';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export function LoginScreen({ navigation }: Props) {
  const { login, exploreDemo, busy, error, baseUrl, saveApiUrl } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlDraft, setUrlDraft] = useState(baseUrl);
  const [urlError, setUrlError] = useState<string | null>(null);

  const saveUrl = async () => {
    const issue = await saveApiUrl(urlDraft);
    if (issue) {
      setUrlError(issue);
      return;
    }
    setEditingUrl(false);
  };

  return (
    <Screen>
      <View style={{ paddingTop: 22, gap: 18 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ width: 58, height: 58, backgroundColor: '#1F3A31', borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: colors.accent, fontSize: 26, fontWeight: '900' }}>V</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Configurar URL del servidor"
            hitSlop={12}
            onPress={() => {
              setUrlDraft(baseUrl);
              setUrlError(null);
              setEditingUrl(true);
            }}
          >
            <MaterialIcons name="link" size={28} color={colors.muted} />
          </Pressable>
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
      <Modal visible={editingUrl} transparent animationType="fade" onRequestClose={() => setEditingUrl(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 20, gap: 14 }}>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>URL del servidor</Text>
            <Field label="Dirección del backend" value={urlDraft} onChangeText={setUrlDraft} keyboardType="url" autoCapitalize="none" placeholder="https://vigia.ejemplo.org" />
            <Text style={{ color: colors.subtle, fontSize: 12 }}>HTTPS para servidores en internet; HTTP solo para pruebas locales.</Text>
            {urlError ? <ErrorMessage>{urlError}</ErrorMessage> : null}
            <PrimaryButton title="Guardar" onPress={() => void saveUrl()} />
            <SecondaryButton title="Cancelar" onPress={() => setEditingUrl(false)} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
