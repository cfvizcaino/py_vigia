import * as SecureStore from 'expo-secure-store';

const sessionTokenKey = 'vigia_session_token';
const edgeTokenKey = 'vigia_edge_token';

export const secureStorage = {
  readSessionToken: () => SecureStore.getItemAsync(sessionTokenKey),
  writeSessionToken: (token: string) => SecureStore.setItemAsync(sessionTokenKey, token),
  clearSessionToken: () => SecureStore.deleteItemAsync(sessionTokenKey),
  readEdgeToken: () => SecureStore.getItemAsync(edgeTokenKey),
  writeEdgeToken: (token: string) => SecureStore.setItemAsync(edgeTokenKey, token),
  clearEdgeToken: () => SecureStore.deleteItemAsync(edgeTokenKey),
};
