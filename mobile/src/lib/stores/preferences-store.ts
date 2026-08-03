import { create } from 'zustand';

import * as secureStorage from '@/lib/secure-storage';

const PRIMARY_METRIC_KEY = 'relay.primary_metric';
const THEME_MODE_KEY = 'relay.theme_mode';
/** Pre-rename key. Read once on hydrate so an installed PWA keeps the setting
 * it already had instead of silently resetting to the default. */
const LEGACY_PRIMARY_METRIC_KEY = 'runcoach.primary_metric';

/** How the user reads their sessions. 'pace' leads with allure and treats the
 * HR zone as secondary (a ceiling on easy runs); 'hr' leads with the zone.
 * Défaut 'pace' : l'utilisateur court à l'allure, pas en zones FC. */
export type PrimaryMetric = 'pace' | 'hr';

/** Which appearance to render. 'system' follows the OS (the default — see
 * `useAppearance`); the other two pin Sable or Graphite. */
export type ThemeMode = 'system' | 'light' | 'dark';

type PreferencesState = {
  primaryMetric: PrimaryMetric;
  themeMode: ThemeMode;
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  setPrimaryMetric: (metric: PrimaryMetric) => Promise<void>;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
};

export const usePreferencesStore = create<PreferencesState>((set) => ({
  primaryMetric: 'pace',
  themeMode: 'system',
  isHydrated: false,

  hydrate: async () => {
    const [metric, legacyMetric, themeMode] = await Promise.all([
      secureStorage.getItem(PRIMARY_METRIC_KEY),
      secureStorage.getItem(LEGACY_PRIMARY_METRIC_KEY),
      secureStorage.getItem(THEME_MODE_KEY),
    ]);

    // Carry the pre-rename value forward once, then drop the old key so the
    // migration doesn't run for the rest of the install's life.
    if (metric == null && legacyMetric != null) {
      await secureStorage.setItem(PRIMARY_METRIC_KEY, legacyMetric);
      await secureStorage.deleteItem(LEGACY_PRIMARY_METRIC_KEY);
    }

    const stored = metric ?? legacyMetric;
    set({
      primaryMetric: stored === 'hr' ? 'hr' : 'pace',
      themeMode: themeMode === 'light' || themeMode === 'dark' ? themeMode : 'system',
      isHydrated: true,
    });
  },

  setPrimaryMetric: async (metric) => {
    await secureStorage.setItem(PRIMARY_METRIC_KEY, metric);
    set({ primaryMetric: metric });
  },

  setThemeMode: async (mode) => {
    await secureStorage.setItem(THEME_MODE_KEY, mode);
    set({ themeMode: mode });
  },
}));
