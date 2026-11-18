import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { saveEdgeConfiguration, verifyEdgeToken } from '../edge/config';
import { Icon } from '../components/Icon';
import { Code, ErrorMessage, GradientText, PrimaryButton, Screen } from '../components/ui';
import { useSession } from '../state/session';
import { fonts, type } from '../theme/fonts';
import { bogotaDateTime, parseApiDate } from '../time/bogota';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'IssuedToken'>;

/** Shows the token once (F03). Nothing keeps it after this screen closes. */
export function IssuedTokenScreen({ navigation, route }: Props) {
  const { issued, command, autonomous = false } = route.params;
  const { baseUrl } = useSession();
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const cameraId = issued.credential.camera_id;

  useEffect(() => {
    navigation.setOptions({ gestureEnabled: false });
  }, [navigation]);

  /** Keeps the token in this phone's secure storage and opens the edge, so it is never copied anywhere. */
  const saveOnThisPhone = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const configuration = { cameraId, serverUrl: baseUrl, token: issued.secret };
      await verifyEdgeToken(configuration);
      await saveEdgeConfiguration(configuration);
      navigation.replace('EdgeMode');
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : 'No fue posible guardar el token en este teléfono.');
      setSaving(false);
    }
  };

  return (
    <Screen>
      <View style={{ alignItems: 'center', marginTop: 4 }}>
        <GradientText text="Token" size={30} />
        <GradientText text={cameraId} size={24} />
      </View>
      <View style={styles.box}>
        <Icon name="warning" size={22} />
        <Text style={[type(fonts.medium, 14, 16.8), { flex: 1 }]}>
          Copia este token ahora: NO se volverá a mostrar. No lo compartas; pégalo directamente en el PC del nodo o teléfono edge
        </Text>
      </View>
      <View style={[styles.box, { paddingHorizontal: 41 }]}>
        <Text selectable style={[type(fonts.medium, 14, 16.8), { flex: 1 }]}>{issued.secret}</Text>
      </View>
      <PrimaryButton
        title={copied ? 'Copiado' : 'Copiar token'}
        icon="copy"
        onPress={() => {
          void Clipboard.setStringAsync(issued.secret).then(() => setCopied(true));
        }}
      />

      {autonomous || !command ? (
        <View style={{ gap: 14, marginTop: 10 }}>
          <Text style={type(fonts.medium, 20, 24)}>Edge autónomo (detección en el teléfono)</Text>
          <Text style={type(fonts.light, 15, 18)}>
            Si este es el teléfono que quedará como cámara, guárdalo aquí: <Text style={{ fontFamily: fonts.medium }}>quedará cifrado y no tendrás que copiarlo.</Text> Si es otro teléfono, ábrelo en VIGÍA → «Edge autónomo» y pega el token.
          </Text>
          <PrimaryButton title="Usar en este teléfono" icon="memory" loading={saving} onPress={() => void saveOnThisPhone()} />
          {saveError ? <ErrorMessage>{saveError}</ErrorMessage> : null}
        </View>
      ) : null}

      {command ? (
        <View style={{ gap: 10, marginTop: 10 }}>
          <Text style={type(fonts.medium, 20, 24)}>En el PC del nodo</Text>
          <Text style={type(fonts.light, 15, 18)}>
            Desde la carpeta del proyecto, ejecuta este comando y pega el token cuando lo pida (no se muestra al escribir):
          </Text>
          <Code>{command}</Code>
        </View>
      ) : null}

      <Text style={[type(fonts.light, 15, 18), { marginTop: 8 }]}>
        Vence: {bogotaDateTime(parseApiDate(issued.credential.expires_at))} (UTC-5)
      </Text>
      <PrimaryButton title="Ya lo guardé" onPress={() => navigation.goBack()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 18, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.10)', paddingVertical: 16, paddingLeft: 23, paddingRight: 12 },
});
