import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SvgXml } from 'react-native-svg';

import { Backdrop, PillButton } from '../components/ui';
import { WELCOME_ART_SVG } from '../components/welcomeArt';
import { useSession } from '../state/session';
import { fonts, type } from '../theme/fonts';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Welcome'>;

/** W01b · Recibimiento con ilustración (Figma 2158:648 + componente 2269:1164). */
export function WelcomeScreen({ navigation }: Props) {
  const { exploreDemo } = useSession();
  return (
    <View style={{ flex: 1 }}>
      <Backdrop glow={false} />
      <SafeAreaView style={{ flex: 1, paddingHorizontal: 43 }}>
        <View style={{ marginTop: 96, gap: 10 }}>
          <Text accessibilityRole="header" style={[type(fonts.poppinsMedium, 32), { textAlign: 'center' }]}>¡Bienvenido/a!</Text>
          <Text style={[type(fonts.poppinsLight, 16), { textAlign: 'center' }]}>
            ¡Hola! Qué bueno tenerte aquí. Comencemos a conectar observaciones.
          </Text>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', marginHorizontal: -7 }}>
          <View style={{ width: '100%', maxWidth: 340, aspectRatio: 340 / 380 }}>
            <SvgXml xml={WELCOME_ART_SVG} width="100%" height="100%" />
            <View accessibilityLabel="Vehículo detectado: automóvil blanco, 92 %" style={{ position: 'absolute', left: '24%', top: '46%', flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 3, paddingLeft: 6, paddingRight: 8, borderRadius: 6, backgroundColor: '#9d76f8' }}>
              <Text style={type(fonts.medium, 10, 12, 0)}>Automóvil · Blanco · 92%</Text>
            </View>
          </View>
        </View>
        <View style={{ gap: 25, marginBottom: 56, paddingHorizontal: 5 }}>
          <PillButton title="Iniciar Sesión" accessibilityLabel="Ir a iniciar sesión" onPress={() => navigation.navigate('Login')} />
          <PillButton title="Explorar Demo" accessibilityLabel="Explorar demo" variant="outline" onPress={exploreDemo} />
        </View>
      </SafeAreaView>
    </View>
  );
}
