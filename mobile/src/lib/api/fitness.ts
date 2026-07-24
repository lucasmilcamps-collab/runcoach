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
