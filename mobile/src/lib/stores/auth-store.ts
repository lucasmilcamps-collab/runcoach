import { create } from 'zustand';

import * as secureStorage from '@/lib/secure-storage';

const ACCESS_TOKEN_KEY = 'runcoach.access_token';
const REFRESH_TOKEN_KEY = 'runcoach.refresh_token';
const GARMIN_CONNECTED_KEY = 'runcoach.garmin_connected';
const ONBOARDING_COMPLETE_KEY = 'runcoach.onboarding_complete';

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
    const [accessToken, refreshToken, garminConnected, onboardingComplete] = await Promise.all([
      secureStorage.getItem(ACCESS_TOKEN_KEY),
      secureStorage.getItem(REFRESH_TOKEN_KEY),
      secureStorage.getItem(GARMIN_CONNECTED_KEY),
      secureStorage.getItem(ONBOARDING_COMPLETE_KEY),
    ]);
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
