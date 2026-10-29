import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SessionProvider, useSession } from './src/state/session';
import { CameraModeScreen } from './src/screens/CameraModeScreen';
import { CamerasScreen } from './src/screens/CamerasScreen';
import { EdgeModeScreen } from './src/screens/EdgeModeScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { QueryScreen } from './src/screens/QueryScreen';
import { ResultsScreen } from './src/screens/ResultsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { colors } from './src/theme/colors';
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
    card: colors.surface,
    text: colors.text,
    border: colors.border,
  },
};

function OperatorTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen name="Cameras" component={CamerasScreen} options={{ title: 'Cámaras', tabBarLabel: 'Cámaras' }} />
      <Tabs.Screen name="Query" component={QueryScreen} options={{ title: 'Nueva consulta', tabBarLabel: 'Consultar' }} />
      <Tabs.Screen name="Results" component={ResultsScreen} options={{ title: 'Resultados', tabBarLabel: 'Resultados' }} />
      <Tabs.Screen name="History" component={HistoryScreen} options={{ title: 'Historial', tabBarLabel: 'Historial' }} />
      <Tabs.Screen name="Settings" component={SettingsScreen} options={{ title: 'Ajustes', tabBarLabel: 'Ajustes' }} />
    </Tabs.Navigator>
  );
}

function AppNavigation() {
  const { restoring, user } = useSession();

  if (restoring) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
        <Text style={{ color: colors.muted, marginTop: 12 }}>Restaurando sesión…</Text>
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text }}>
      {user ? (
        <>
          <Stack.Screen name="Operator" component={OperatorTabs} options={{ headerShown: false }} />
          <Stack.Screen name="CameraMode" component={CameraModeScreen} options={{ title: 'Modo cámara' }} />
          <Stack.Screen name="EdgeMode" component={EdgeModeScreen} options={{ title: 'Edge autónomo' }} />
        </>
      ) : (
        <>
          <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'VIGÍA', headerShown: false }} />
          <Stack.Screen name="CameraMode" component={CameraModeScreen} options={{ title: 'Modo cámara' }} />
          <Stack.Screen name="EdgeMode" component={EdgeModeScreen} options={{ title: 'Edge autónomo' }} />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <UpdateHost>
          <NavigationContainer theme={navigationTheme}>
            <StatusBar style="light" />
            <AppNavigation />
          </NavigationContainer>
        </UpdateHost>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
