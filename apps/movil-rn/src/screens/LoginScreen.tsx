import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '../components/Icon';
import { Backdrop, ErrorMessage, PillButton } from '../components/ui';
import { useSession } from '../state/session';
import { colors, gradients } from '../theme/colors';
import { fonts, type } from '../theme/fonts';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

/** «iniciar sesión» (Figma 2159:660), validación A04/A04b y «URL del Backend» (2167:142). */
export function LoginScreen({ navigation }: Props) {
  const { login, saveApiUrl, busy, error, baseUrl } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [urlDialogVisible, setUrlDialogVisible] = useState(false);
  const [url, setUrl] = useState(baseUrl);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [savingUrl, setSavingUrl] = useState(false);

  const submit = async () => {
    const cleanEmail = email.trim();
    const badEmail = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail);
    setEmailError(badEmail ? 'Ingresa un correo válido.' : null);
    setPasswordError(!password ? 'Ingresa tu contraseña.' : null);
    if (badEmail || !password) return;
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

  return (
    <View style={{ flex: 1 }}>
      <Backdrop glow={false} />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <View style={styles.bar}>
          <Pressable accessibilityRole="button" accessibilityLabel="Volver" hitSlop={12} onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Welcome'))}>
            <Icon name="arrowBack" size={20} color="#ffffff" />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Configurar URL del servidor"
            hitSlop={12}
            onPress={() => {
              setUrl(baseUrl);
              setUrlError(null);
              setUrlDialogVisible(true);
            }}
          >
            <Icon name="ms_link" size={24} color="#ffffff" />
          </Pressable>
        </View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: 137 }} keyboardShouldPersistTaps="handled">
            <LinearGradient colors={gradients.loginSheet} locations={[0.01, 0.49, 0.98]} style={styles.sheet}>
              <Text accessibilityRole="header" style={[type(fonts.poppinsMedium, 28), styles.center, { width: 220 }]}>¡Bienvenido de vuelta!</Text>
              <Text style={[type(fonts.poppinsLight, 16), styles.center, { marginTop: 16 }]}>
                ¿Listo para continuar?{'\n'}<Text style={{ fontFamily: fonts.poppinsMedium }}>Tus cámaras te esperan</Text>
              </Text>
              <View style={{ alignSelf: 'stretch', marginTop: 24, gap: 4 }}>
                <LoginField label="Usuario" accessibilityLabel="Correo electrónico" value={email} onChangeText={(value) => { setEmail(value); setEmailError(null); }} keyboardType="email-address" error={emailError} />
                <LoginField
                  label="Contraseña"
                  accessibilityLabel="Contraseña"
                  value={password}
                  onChangeText={(value) => { setPassword(value); setPasswordError(null); }}
                  secureTextEntry={!passwordVisible}
                  error={passwordError ?? (error ? '' : null)}
                  trailing={(
                    <Pressable accessibilityRole="button" accessibilityLabel={passwordVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'} hitSlop={12} onPress={() => setPasswordVisible((value) => !value)}>
                      <Icon name="visibilityOff" size={17} color="#ffffff" />
                    </Pressable>
                  )}
                />
                <Pressable
                  accessibilityRole="link"
                  hitSlop={8}
                  onPress={() => Alert.alert('Olvidé mi contraseña', 'Pide a un administrador de VIGÍA que restablezca tu contraseña desde la consola web.')}
                  style={{ alignSelf: 'flex-end', marginTop: 6, marginRight: 4 }}
                >
                  <Text style={[type(fonts.poppinsLight, 13), { color: colors.accentDeep, textDecorationLine: 'underline' }]}>Olvidé mi contraseña</Text>
                </Pressable>
              </View>
              {error ? (
                <View style={[styles.serverError, { marginTop: 14 }]}>
                  <ErrorMessage>{error}</ErrorMessage>
                </View>
              ) : null}
              <PillButton
                title="Iniciar Sesión"
                accessibilityLabel="Iniciar sesión"
                variant="gradient"
                height={53}
                fontSize={20}
                loading={busy}
                onPress={() => void submit()}
                style={{ alignSelf: 'stretch', marginTop: 30 }}
              />
              <View style={{ marginTop: 42, gap: 21, alignItems: 'center' }}>
                <SheetLink icon="videocam" title="Usar este teléfono como cámara" onPress={() => navigation.navigate('CameraMode')} />
                <SheetLink icon="memory" title="Edge autónomo" onPress={() => navigation.navigate('EdgeMode')} />
              </View>
            </LinearGradient>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <Modal animationType="fade" onRequestClose={() => setUrlDialogVisible(false)} transparent visible={urlDialogVisible} statusBarTranslucent>
        <View style={styles.dim}>
          <View style={styles.urlPanel}>
            <Text style={[type(fonts.poppinsMedium, 24), styles.center]}>URL del Backend</Text>
            <View style={[styles.urlField, urlError ? { borderColor: colors.danger } : null]}>
              <Text style={[type(fonts.poppinsLight, 10), { textAlign: 'center' }]}>Dirección del servidor</Text>
              <TextInput
                accessibilityLabel="Dirección del servidor"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                onChangeText={setUrl}
                placeholder="https://servidor.vigia"
                placeholderTextColor="rgba(222,228,224,0.5)"
                style={[type(fonts.regular, 16, 24, 0), { color: '#dee4e0', padding: 0 }]}
                value={url}
              />
            </View>
            <Text style={[type(fonts.poppinsLight, 10), styles.center]}>Emulador Android: http://10.0.2.2:8000. HTTP solo en localhost y redes locales.</Text>
            {urlError ? <ErrorMessage>{urlError}</ErrorMessage> : null}
            <PillButton title="Guardar" variant="white" loading={savingUrl} onPress={() => void persistUrl()} style={{ alignSelf: 'stretch', marginHorizontal: 13 }} />
            <Pressable accessibilityRole="button" disabled={savingUrl} onPress={() => setUrlDialogVisible(false)}>
              <Text style={[type(fonts.poppins, 18), styles.center]}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function LoginField({ label, accessibilityLabel, value, onChangeText, secureTextEntry, keyboardType, error, trailing }: {
  label: string; accessibilityLabel: string; value: string; onChangeText: (value: string) => void;
  secureTextEntry?: boolean; keyboardType?: 'email-address'; error: string | null; trailing?: ReactNode;
}) {
  return (
    <View style={{ gap: 4, marginBottom: 14 }}>
      <View style={[styles.loginField, error !== null && { borderColor: colors.danger, borderWidth: 1.5 }]}>
        <TextInput
          accessibilityLabel={accessibilityLabel}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={keyboardType}
          onChangeText={onChangeText}
          placeholder={label}
          placeholderTextColor="rgba(255,255,255,0.8)"
          secureTextEntry={secureTextEntry}
          style={[type(fonts.poppinsLight, 16), { flex: 1, padding: 0 }]}
          value={value}
        />
        {trailing}
      </View>
      {error ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 6 }}>
          <Icon name="ms_error" size={13} color={colors.danger} />
          <Text accessibilityRole="alert" style={[type(fonts.regular, 11, 14, 0), { color: colors.danger }]}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

function SheetLink({ icon, title, onPress }: { icon: 'videocam' | 'memory'; title: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} hitSlop={8} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
      <Icon name={icon} size={20} color={colors.accentDeep} />
      <Text style={[type(fonts.poppins, 12), { color: colors.accentDeep }]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  center: { textAlign: 'center', alignSelf: 'center' },
  sheet: { flexGrow: 1, borderTopLeftRadius: 34, borderTopRightRadius: 34, paddingTop: 65, paddingHorizontal: 40, paddingBottom: 48, alignItems: 'center' },
  loginField: { height: 60, borderRadius: 24, borderWidth: 1, borderColor: '#ffffff', flexDirection: 'row', alignItems: 'center', paddingLeft: 47, paddingRight: 37, gap: 10 },
  serverError: { alignSelf: 'stretch', padding: 12, borderRadius: 14, backgroundColor: 'rgba(9,1,25,0.35)' },
  dim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  urlPanel: { width: 308, maxWidth: '100%', borderRadius: 34, backgroundColor: 'rgba(43,3,79,0.96)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)', paddingVertical: 50, paddingHorizontal: 38, gap: 14 },
  urlField: { borderRadius: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)', backgroundColor: 'rgba(9,1,25,0.2)', paddingVertical: 8, paddingHorizontal: 12, gap: 2 },
});
