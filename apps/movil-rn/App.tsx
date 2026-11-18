import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Path, Stop } from 'react-native-svg';

import { Icon } from './src/components/Icon';
import type { IconName } from './src/components/Icon';
import { tapFeedback } from './src/components/motion';
import { Opening } from './src/components/Opening';
import { Backdrop } from './src/components/ui';
import { SessionProvider, useSession } from './src/state/session';
import { AddEdgeScreen } from './src/screens/AddEdgeScreen';
import { CameraDetailScreen } from './src/screens/CameraDetailScreen';
import { IssuedTokenScreen } from './src/screens/IssuedTokenScreen';
import { RelocateEdgeScreen } from './src/screens/RelocateEdgeScreen';
import { CameraModeScreen } from './src/screens/CameraModeScreen';
import { CamerasScreen } from './src/screens/CamerasScreen';
import { EdgeModeScreen } from './src/screens/EdgeModeScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { QueryScreen } from './src/screens/QueryScreen';
import { ResultsScreen } from './src/screens/ResultsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { colors, gradients } from './src/theme/colors';
import { fonts, type } from './src/theme/fonts';
import type { RootStackParamList, TabParamList } from './src/types/navigation';
import { UpdateHost } from './src/update/UpdateHost';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<TabParamList>();

const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.background,
    card: colors.background,
    text: colors.text,
    border: 'transparent',
  },
};

/** Iconos y tamaños de la barra inferior del Figma («Group 1»). */
const TAB_ICONS: Record<keyof TabParamList, { name: IconName; size: number }> = {
  Cameras: { name: 'tabCameras', size: 28 },
  Query: { name: 'tabQuery', size: 26 },
  Results: { name: 'tabResults', size: 28 },
  History: { name: 'tabHistory', size: 30 },
  Settings: { name: 'tabSettings', size: 23 },
};

/**
 * Barra inferior: degradado translúcido de radio 21 y la casilla de vidrio de 63 × 70, que se
 * desliza hasta la pestaña activa (sin rebote) en vez de saltar.
 */
function VigiaTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const itemWidth = width ? (width - TAB_PADDING * 2) / state.routes.length : 0;
  const offset = useSharedValue(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!itemWidth) return;
    const target = TAB_PADDING + state.index * itemWidth + (itemWidth - TAB_SLOT_WIDTH) / 2;
    offset.set(reduced || offset.get() === 0 ? target : withTiming(target, { duration: 280, easing: Easing.out(Easing.cubic) }));
  }, [itemWidth, offset, reduced, state.index]);
  const slotStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }));
  return (
    <View style={{ backgroundColor: colors.backgroundEnd }}>
      <LinearGradient
        colors={gradients.tabBar}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[tabStyles.bar, { paddingBottom: insets.bottom }]}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        {itemWidth ? <Animated.View pointerEvents="none" style={[tabStyles.slider, slotStyle]} /> : null}
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const options = descriptors[route.key]?.options;
          const icon = TAB_ICONS[route.name as keyof TabParamList];
          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityLabel={`${String(options?.tabBarLabel ?? route.name)}, ${route.name}, tab`}
              accessibilityState={{ selected: focused }}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) {
                  tapFeedback('selection');
                  navigation.navigate(route.name, route.params);
                }
              }}
              style={tabStyles.item}
            >
              <View style={[tabStyles.slot, !itemWidth && focused && tabStyles.slotOn]}>
                <Icon name={icon.name} size={icon.size} color={focused ? '#ffffff' : colors.icon} />
              </View>
            </Pressable>
          );
        })}
      </LinearGradient>
    </View>
  );
}

function OperatorTabs() {
  return (
    <Tabs.Navigator tabBar={(props) => <VigiaTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="Cameras" component={CamerasScreen} options={{ title: 'Cámaras', tabBarLabel: 'Cámaras' }} />
      <Tabs.Screen name="Query" component={QueryScreen} options={{ title: 'Nueva consulta', tabBarLabel: 'Consultar' }} />
      <Tabs.Screen name="Results" component={ResultsScreen} options={{ title: 'Resultados', tabBarLabel: 'Resultados' }} />
      <Tabs.Screen name="History" component={HistoryScreen} options={{ title: 'Historial', tabBarLabel: 'Historial' }} />
      <Tabs.Screen name="Settings" component={SettingsScreen} options={{ title: 'Ajustes', tabBarLabel: 'Ajustes' }} />
    </Tabs.Navigator>
  );
}

/** A01 · Restaurar sesión: el isotipo quieto, igual al último cuadro con logo de la apertura. */
function RestoringSession() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 36 }}>
      <Backdrop />
      <Svg width={102} height={94} viewBox="0 0 61 56">
        <Defs>
          <SvgLinearGradient id="restore-logo" x1="0" y1="0" x2="61" y2="56" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#cbb8ff" />
            <Stop offset="0.48" stopColor="#9d76f8" />
            <Stop offset="1" stopColor="#7d43e4" />
          </SvgLinearGradient>
        </Defs>
        <Path d="M27 0L39.5 23L46.5 8L38.5 8L35 0L61 0L38.8 39.5L22 8L13.5 8L35 47L30.5 56L0 0L27 0Z" fill="url(#restore-logo)" />
      </Svg>
      <View style={{ alignItems: 'center', gap: 12 }}>
        <Text style={[type(fonts.regular, 15), { textAlign: 'center' }]}>Restaurando sesión…</Text>
        <View style={{ width: 160, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)' }}>
          <View style={{ width: 64, height: 3, borderRadius: 2, backgroundColor: colors.accent }} />
        </View>
        <Text style={[type(fonts.light, 11), { opacity: 0.6, textAlign: 'center' }]}>Verificando el token guardado en Keychain/Keystore</Text>
      </View>
    </View>
  );
}

function AppNavigation() {
  const { restoring, user } = useSession();

  if (restoring) return <RestoringSession />;

  return (
    <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background }, animation: 'fade' }}>
      {user ? (
        <>
          <Stack.Screen name="Operator" component={OperatorTabs} />
          <Stack.Screen name="CameraDetail" component={CameraDetailScreen} />
          {/* Alta y traslado de un edge suben desde abajo, como una hoja, en vez de aparecer de golpe. */}
          <Stack.Screen name="AddEdge" component={AddEdgeScreen} options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="RelocateEdge" component={RelocateEdgeScreen} options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="IssuedToken" component={IssuedTokenScreen} options={{ gestureEnabled: false }} />
          <Stack.Screen name="CameraMode" component={CameraModeScreen} />
          <Stack.Screen name="EdgeMode" component={EdgeModeScreen} />
        </>
      ) : (
        <>
          <Stack.Screen name="Welcome" component={WelcomeScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="CameraMode" component={CameraModeScreen} />
          <Stack.Screen name="EdgeMode" component={EdgeModeScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}

// La apertura solo se muestra en el arranque en frío (no en pruebas).
const showOpening = !process.env.JEST_WORKER_ID;

export default function App() {
  const [opening, setOpening] = useState(showOpening);
  const finishOpening = useCallback(() => setOpening(false), []);
  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <SessionProvider>
          <UpdateHost>
            <NavigationContainer theme={navigationTheme}>
              <StatusBar style="light" />
              <AppNavigation />
            </NavigationContainer>
          </UpdateHost>
        </SessionProvider>
        {opening ? <Opening onDone={finishOpening} /> : null}
      </View>
    </SafeAreaProvider>
  );
}

const TAB_PADDING = 16;
const TAB_SLOT_WIDTH = 63;

const tabStyles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopLeftRadius: 21, borderTopRightRadius: 21, paddingHorizontal: TAB_PADDING, minHeight: 85 },
  item: { flex: 1, alignItems: 'center' },
  slot: { width: TAB_SLOT_WIDTH, height: 70, marginTop: 1, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  slotOn: { backgroundColor: 'rgba(222,228,224,0.20)' },
  slider: { position: 'absolute', left: 0, top: 1, width: TAB_SLOT_WIDTH, height: 70, borderRadius: 15, backgroundColor: 'rgba(222,228,224,0.20)' },
});
