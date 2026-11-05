import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';

import { saveEdgeConfiguration, verifyEdgeToken } from '../edge/config';
import { ErrorMessage, PrimaryButton, Screen, SecondaryButton } from '../components/ui';
import { useSession } from '../state/session';
import { colors } from '../theme/colors';
import { bogotaDateTime, parseApiDate } from '../time/bogota';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'IssuedToken'>;

const mono = Platform.select({ android: 'monospace', default: 'Courier' });

/** Shows the token once (F03). Nothing keeps it after this screen closes. */
export function IssuedTokenScreen({ navigation, route }: Props) {
  const { issued, command, autonomous = false } = route.params;
  const { baseUrl } = useSession();
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const cameraId = issued.credential.camera_id;

  useEffect(() => {
    navigation.setOptions({ title: `Token de ${cameraId}`, headerBackVisible: false, gestureEnabled: false });
  }, [cameraId, navigation]);

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
      <View style={{ backgroundColor: '#302517', borderRadius: 6, padding: 14 }}>
        <Text style={{ color: '#FFE1B0', lineHeight: 20 }}>
          Copia este token ahora: no se volverá a mostrar. No lo envíes por chat ni correo; pégalo directamente en el PC del nodo o en el teléfono del edge.
        </Text>
      </View>
      <View style={{ backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 6, padding: 12 }}>
        <Text selectable style={{ color: colors.text, fontFamily: mono, fontSize: 14 }}>{issued.secret}</Text>
      </View>
      <SecondaryButton
        title={copied ? 'Copiado' : 'Copiar token'}
        onPress={() => {
          void Clipboard.setStringAsync(issued.secret).then(() => setCopied(true));
        }}
      />

      {autonomous || !command ? (
        <View style={{ gap: 10 }}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>Edge autónomo (detección en el teléfono)</Text>
          <Text style={{ color: colors.muted, lineHeight: 20 }}>
            Si este es el teléfono que quedará como cámara, guárdalo aquí: el token se queda cifrado en el teléfono y no hay que copiarlo. Si es otro teléfono, ábrelo en VIGÍA → «Edge autónomo» y pega el token.
          </Text>
          <PrimaryButton title="Usar en este teléfono" loading={saving} onPress={() => void saveOnThisPhone()} />
          {saveError ? <ErrorMessage>{saveError}</ErrorMessage> : null}
        </View>
      ) : null}

      {command ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>En el PC del nodo</Text>
          <Text style={{ color: colors.muted, lineHeight: 20 }}>
            Desde la carpeta del proyecto, ejecuta este comando y pega el token cuando lo pida (no se muestra al escribir):
          </Text>
          <Text selectable style={{ color: colors.text, fontFamily: mono }}>{command}</Text>
        </View>
      ) : null}

      <Text style={{ color: colors.muted, fontSize: 12 }}>
        Vence: {bogotaDateTime(parseApiDate(issued.credential.expires_at))} (hora de Colombia).
      </Text>
      <SecondaryButton title="Ya lo guardé" onPress={() => navigation.goBack()} />
    </Screen>
  );
}
