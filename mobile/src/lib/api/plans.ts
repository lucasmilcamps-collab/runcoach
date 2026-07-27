import { apiClient } from '@/lib/api/client';
import type { SportType } from '@/lib/api/types';

export type Weekday =
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY'
  | 'SUNDAY';

export type FixedSport = { sport: SportType; day: Weekday };

export type PlanRequest = {
  goal_type: 'race' | 'distance' | 'fitness';
  distance_km: number | null;
  race_date: string | null; // ISO date
  target_time_min: number | null;
  available_days: Weekday[];
  max_run_sessions_per_week: number;
  fixed_sports: FixedSport[];
};

export type SessionType =
  | 'easy'
  | 'long_run'
  | 'tempo'
  | 'threshold'
  | 'intervals'
  | 'recovery'
  | 'cross_training'
  | 'rest';

export type PlanSession = {
  day: Weekday;
  sport: SportType;
  type: SessionType;
  duration_min: number;
  structure: { label: string; duration_min: number }[];
  pace_range: { min_per_km_low: string; min_per_km_high: string } | null;
  hr_zone: number | null;
  rationale: string;
};

export type PlanWeek = {
  index: number;
  is_deload: boolean;
  target_load: number;
  sessions: PlanSession[];
};

export type PlanPhase = {
  name: 'base' | 'build' | 'peak' | 'taper';
  weeks: PlanWeek[];
};

export type Plan = {
  goal: { description: string; distance_km: number | null; race_date: string | null };
  phases: PlanPhase[];
};

export type PlanResponse = {
  id: string;
  status: 'generating' | 'ready' | 'failed';
  request: PlanRequest | null;
  plan: Plan | null;
  error_message: string | null;
};

export type DailyAdjustment = {
  adjusted: boolean;
  original_type: SessionType;
  suggested_type: SessionType;
  reason: string;
};

/** Overnight recovery readings (Garmin) behind today's adjustment. */
export type RecoverySummary = {
  hrv: number | null;
  hrv_baseline: number | null;
  resting_hr: number | null;
  resting_hr_baseline: number | null;
  sleep_hours: number | null;
  body_battery: number | null;
  date: string | null;
};

export type TodaySession = {
  date: string;
  has_plan: boolean;
  has_session: boolean;
  week_index: number | null;
  session: PlanSession | null;
  adjustment: DailyAdjustment | null;
  tsb: number;
  recovery: RecoverySummary | null;
  message: string | null;
};

export type PlanProgress = {
  has_plan: boolean;
  week_current: number | null;
  weeks_total: number | null;
  recent_key_planned: number;
  recent_key_completed: number;
  recent_key_missed: number;
  tsb: number;
  replan_suggested: boolean;
  replan_reason: string | null;
};

/** A user-declared injury — triggers a comeback replan. */
export type InjuryReport = {
  area: string;
  severity: 'gene' | 'douleur' | 'arret';
  days_off: number;
};

export function getPlanProgress() {
  return apiClient.get<PlanProgress>('/api/v1/plans/progress');
}

/**
 * Declare an injury and regenerate the remaining plan as a comeback (eased-off
 * period then a gradual ramp). Reuses the current plan's objective.
 */
export function reportInjury(injury: InjuryReport) {
  return apiClient.post<PlanResponse>('/api/v1/plans/replan-injury', injury);
}

export function getCurrentPlan() {
  return apiClient.get<PlanResponse>('/api/v1/plans/current');
}

/** One entry in the read-only plan history. */
export type PlanVersionSummary = {
  version: number;
  created_at: string;
  goal_description: string | null;
  race_date: string | null;
  weeks_total: number | null;
  reason: string;
  injury_area: string | null;
};

export function getPlanVersions() {
  return apiClient.get<PlanVersionSummary[]>('/api/v1/plans/versions');
}

export function getPlanVersion(version: number) {
  return apiClient.get<PlanResponse>(`/api/v1/plans/versions/${version}`);
}

/**
 * Today's planned session, deterministically adjusted for current form (TSB).
 * No AI, no cost — the adjustment and its reason are computed server-side.
 */
export function getTodaySession() {
  return apiClient.get<TodaySession>('/api/v1/plans/today');
}

/**
 * Generate a new plan. Resolves only when the backend has generated, validated,
 * and stored it (synchronous, like the Garmin sync) — can take ~10-30s.
 */
export function createPlan(request: PlanRequest) {
  return apiClient.post<PlanResponse>('/api/v1/plans', request);
}
