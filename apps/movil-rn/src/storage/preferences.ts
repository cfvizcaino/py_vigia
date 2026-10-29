import AsyncStorage from '@react-native-async-storage/async-storage';

const apiUrlKey = 'vigia_api_base_url';
const defaultApiUrl = process.env.EXPO_PUBLIC_VIGIA_DEFAULT_API ?? 'http://10.0.2.2:8000';

export const preferences = {
  async getApiUrl(): Promise<string> {
    return (await AsyncStorage.getItem(apiUrlKey)) ?? defaultApiUrl;
  },
  saveApiUrl: (url: string) => AsyncStorage.setItem(apiUrlKey, url),
  async get(key: string): Promise<string | null> {
    return AsyncStorage.getItem(key);
  },
  set: (key: string, value: string) => AsyncStorage.setItem(key, value),
  remove: (key: string) => AsyncStorage.removeItem(key),
};
