import { create } from 'zustand';

import * as secureStorage from '@/lib/secure-storage';

const PRIMARY_METRIC_KEY = 'runcoach.primary_metric';

/** How the user reads their sessions. 'pace' leads with allure and treats the
 * HR zone as secondary (a ceiling on easy runs); 'hr' leads with the zone.
 * Défaut 'pace' : l'utilisateur court à l'allure, pas en zones FC. */
export type PrimaryMetric = 'pace' | 'hr';

type PreferencesState = {
  primaryMetric: PrimaryMetric;
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  setPrimaryMetric: (metric: PrimaryMetric) => Promise<void>;
};

export const usePreferencesStore = create<PreferencesState>((set) => ({
  primaryMetric: 'pace',
  isHydrated: false,

  hydrate: async () => {
    const stored = await secureStorage.getItem(PRIMARY_METRIC_KEY);
    set({
      primaryMetric: stored === 'hr' ? 'hr' : 'pace',
      isHydrated: true,
    });
  },

  setPrimaryMetric: async (metric) => {
    await secureStorage.setItem(PRIMARY_METRIC_KEY, metric);
    set({ primaryMetric: metric });
  },
}));
