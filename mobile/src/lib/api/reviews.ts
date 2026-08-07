import { apiClient } from '@/lib/api/client';

import type { Weekday } from '@/lib/api/plans';

/**
 * Which signal is allowed to judge a session. Mirrors the backend, which mirrors
 * the training-science rule: HR governs Z1–Z2 work, pace governs quality work on
 * flat ground, and HR takes over when the ground isn't flat. An easy run up a
 * hill is not a failed easy run, and the UI must not present it as one.
 */
export type GoverningSignal = 'hr' | 'pace' | 'none';

export type SessionReview = {
  day: Weekday;
  slot: 'primary' | 'addon';
  type: string;
  sport: string;
  priority: 'key' | 'optional';
  planned_duration_min: number;
  planned_pace_low: string | null;
  planned_pace_high: string | null;
  planned_hr_zone: number | null;
  skipped: boolean;

  done: boolean;
  linked: boolean;
  actual_duration_min: number | null;
  actual_distance_km: number | null;
  actual_pace_min_per_km: string | null;
  actual_avg_hr: number | null;
  actual_elevation_gain_m: number | null;

  /** Positive = the second half was slower / costlier than the first. */
  pace_drift_pct: number | null;
  hr_drift_bpm: number | null;

  governing_signal: GoverningSignal;
};

/**
 * The week that just ended.
 *
 * `needs_adjustment` is decided by deterministic rules on the backend — no AI is
 * involved in the verdict. `summary` is the one AI-written field and is present
 * only when an adjustment is warranted, which is why an ordinary week costs
 * nothing. Like `replan_suggested`, it is a suggestion: acting on it stays the
 * athlete's call, and nothing here regenerates a plan on its own.
 */
export type WeeklyReview = {
  has_plan: boolean;
  week_index: number | null;
  week_start: string | null; // ISO date
  week_end: string | null;

  sessions: SessionReview[];

  key_planned: number;
  key_completed: number;
  key_missed: number;

  load_actual: number;
  ctl: number;
  atl: number;
  tsb: number;
  ctl_ramp_pct: number | null;

  needs_adjustment: boolean;
  signals: string[];
  summary: string | null;
};

export function getWeeklyReview() {
  return apiClient.get<WeeklyReview>('/api/v1/reviews/weekly');
}
