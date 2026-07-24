import { apiClient } from '@/lib/api/client';

export type FitnessDay = {
  day: string; // ISO date
  load: number;
  ctl: number;
  atl: number;
  tsb: number;
};

export type Fitness = {
  has_profile: boolean;
  hr_max: number | null;
  hr_rest: number | null;
  manual: boolean; // HRmax/HRrest were entered by the athlete, not Garmin
  low_confidence: boolean;
  ctl: number; // fitness (42-day)
  atl: number; // fatigue (7-day)
  tsb: number; // form (fitness − fatigue)
  series: FitnessDay[];
};

/**
 * Fitness/fatigue/form (CTL/ATL/TSB), recomputed server-side from stored
 * activities + the HR profile — no resync needed to see fresh numbers.
 */
export function getFitness() {
  return apiClient.get<Fitness>('/api/v1/fitness');
}

/**
 * Set HRmax/HRrest by hand — the legitimate fallback when Garmin doesn't expose
 * them. These take priority and a Garmin sync won't overwrite them. Returns the
 * freshly recomputed fitness so the caller can reflect it immediately.
 */
export function updateFitnessProfile(hrMax: number, hrRest: number) {
  return apiClient.put<Fitness>('/api/v1/fitness/profile', {
    hr_max: hrMax,
    hr_rest: hrRest,
  });
}
