import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * expo-secure-store has no web implementation. Native keeps the RunCoach
 * session JWTs in the platform keychain/keystore; web falls back to
 * localStorage, which is readable by any script on the page (XSS-exposed).
 * This is a real, disclosed tradeoff, not a PRODUCT.md-approved one: it's
 * accepted here because web is a secondary/dev-convenience target for a
 * single-user tool, not because the risk doesn't exist. Note this only
 * covers the app's own JWTs — the user's Garmin password itself is never
 * stored client-side at all (see lib/api/garmin.ts).
 */
export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return window.localStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    window.localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    window.localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
