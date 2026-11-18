import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo-modules-core';

import { saveEdgeConfiguration } from '../edge/config';
import { preferences } from './preferences';
import { secureStorage } from './secure';

/** What the Flutter app left on the phone, by its own key names. */
export type FlutterData = Partial<Record<
  'vigia_api_base_url' | 'vigia_edge_camera' | 'vigia_edge_server' | 'vigia_session_token' | 'vigia_edge_token',
  string
>>;

export interface FlutterDataSource {
  readFlutterData(): Promise<FlutterData>;
  clearFlutterData(): Promise<void>;
}

const migratedKey = 'vigia_flutter_migrated';

/**
 * Runs once, on the first start after updating from the Flutter app (1.4.0 or
 * earlier): copies the backend URL, the session and the edge configuration
 * into the new storage, then deletes the Flutter copies. Values already in the
 * new storage win. On failure nothing is deleted and it is retried next start.
 */
export async function migrateFlutterData(
  source: FlutterDataSource | null = requireOptionalNativeModule<FlutterDataSource>('VigiaCameraServer'),
): Promise<void> {
  if (!source || (await AsyncStorage.getItem(migratedKey))) return;
  const data = await source.readFlutterData();
  if (Object.keys(data).length) {
    if (data.vigia_api_base_url && !(await preferences.get('vigia_api_base_url'))) {
      await preferences.saveApiUrl(data.vigia_api_base_url);
    }
    if (data.vigia_session_token && !(await secureStorage.readSessionToken())) {
      await secureStorage.writeSessionToken(data.vigia_session_token);
    }
    const { vigia_edge_camera: cameraId, vigia_edge_server: serverUrl, vigia_edge_token: token } = data;
    if (cameraId && serverUrl && token && !(await secureStorage.readEdgeToken())) {
      await saveEdgeConfiguration({ cameraId, serverUrl, token });
    }
    await source.clearFlutterData();
  }
  await AsyncStorage.setItem(migratedKey, new Date().toISOString());
}
