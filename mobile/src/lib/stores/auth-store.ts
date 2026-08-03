import { create } from 'zustand';

import * as secureStorage from '@/lib/secure-storage';

const ACCESS_TOKEN_KEY = 'relay.access_token';
const REFRESH_TOKEN_KEY = 'relay.refresh_token';
const GARMIN_CONNECTED_KEY = 'relay.garmin_connected';
const ONBOARDING_COMPLETE_KEY = 'relay.onboarding_complete';

/** Pre-rename keys, in the same order. Renaming the namespace would otherwise
 * sign every installed app out on the update that ships it — the session is
 * moved across once, on the first hydrate that finds nothing under the new
 * names, and the old keys are then removed. */
const LEGACY_KEYS = [
  'runcoach.access_token',
  'runcoach.refresh_token',
  'runcoach.garmin_connected',
  'runcoach.onboarding_complete',
] as const;

type AuthState = {
  accessToken: string | null;
  refreshToken: string | null;
  garminConnected: boolean;
  /** True once the user reaches the dashboard, whether by connecting Garmin
   * or explicitly deferring it — distinct from garminConnected so "Plus tard"
   * doesn't send the user back through /garmin-connect on every relaunch. */
  onboardingComplete: boolean;
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  setTokens: (accessToken: string, refreshToken: string) => Promise<void>;
  setGarminConnected: (connected: boolean) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  signOut: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  refreshToken: null,
  garminConnected: false,
  onboardingComplete: false,
  isHydrated: false,

  hydrate: async () => {
    const keys = [
      ACCESS_TOKEN_KEY,
      REFRESH_TOKEN_KEY,
      GARMIN_CONNECTED_KEY,
      ONBOARDING_COMPLETE_KEY,
    ] as const;
    let values = await Promise.all(keys.map((key) => secureStorage.getItem(key)));

    // Nothing under the new namespace: either a fresh install (all legacy reads
    // come back null too, and this is a no-op) or an app updated across the
    // rename, whose session is moved over here rather than dropped.
    if (values.every((value) => value == null)) {
      const legacy = await Promise.all(LEGACY_KEYS.map((key) => secureStorage.getItem(key)));
      if (legacy.some((value) => value != null)) {
        await Promise.all(
          legacy.map((value, i) => (value == null ? null : secureStorage.setItem(keys[i], value))),
        );
        await Promise.all(LEGACY_KEYS.map((key) => secureStorage.deleteItem(key)));
        values = legacy;
      }
    }

    const [accessToken, refreshToken, garminConnected, onboardingComplete] = values;
    set({
      accessToken,
      refreshToken,
      garminConnected: garminConnected === 'true',
      onboardingComplete: onboardingComplete === 'true',
      isHydrated: true,
    });
  },

  setTokens: async (accessToken, refreshToken) => {
    await Promise.all([
      secureStorage.setItem(ACCESS_TOKEN_KEY, accessToken),
      secureStorage.setItem(REFRESH_TOKEN_KEY, refreshToken),
    ]);
    set({ accessToken, refreshToken });
  },

  setGarminConnected: async (connected) => {
    await Promise.all([
      secureStorage.setItem(GARMIN_CONNECTED_KEY, String(connected)),
      secureStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true'),
    ]);
    set({ garminConnected: connected, onboardingComplete: true });
  },

  completeOnboarding: async () => {
    await secureStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
    set({ onboardingComplete: true });
  },

  signOut: async () => {
    await Promise.all([
      secureStorage.deleteItem(ACCESS_TOKEN_KEY),
      secureStorage.deleteItem(REFRESH_TOKEN_KEY),
      secureStorage.deleteItem(GARMIN_CONNECTED_KEY),
      secureStorage.deleteItem(ONBOARDING_COMPLETE_KEY),
    ]);
    set({ accessToken: null, refreshToken: null, garminConnected: false, onboardingComplete: false });
  },
}));
