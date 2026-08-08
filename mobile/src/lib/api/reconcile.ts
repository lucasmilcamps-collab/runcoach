import type { Activity } from '@/lib/api/activities';
import { apiClient } from '@/lib/api/client';
import type { SessionType, Weekday } from '@/lib/api/plans';
import type { SportType } from '@/lib/api/types';

/**
 * A session from an elapsed week that was never settled — neither linked to an
 * activity nor declared missed.
 *
 * It is not a neutral gap: adherence already counts it as missed and that feeds
 * the replan suggestion, so the plan is reacting to something the athlete never
 * actually said.
 */
export type PendingSession = {
  week_index: number;
  day: Weekday;
  slot: 'primary' | 'addon';
  session_date: string; // ISO date
  type: SessionType;
  sport: SportType;
  duration_min: number;
  priority: 'key' | 'optional';
  /**
   * An activity recorded that day that would validate this session. Pre-filled
   * so settling is one tap — and it always respects the backend's sport rule, so
   * a suggestion is never a button that answers 409.
   */
  suggested_activity: Activity | null;
};

export type WeekReconciliation = {
  has_pending: boolean;
  sessions: PendingSession[];
  /** Weeks covered, oldest first. Bounded to the 14-day adherence window. */
  week_indices: number[];
};

export function getReconciliation() {
  return apiClient.get<WeekReconciliation>('/api/v1/plans/reconcile');
}

/** Link every pending session that came with a suggested activity. */
export function confirmAllSuggested() {
  return apiClient.post<{ linked: number }>('/api/v1/plans/reconcile/confirm-all', {});
}

/** Declare every remaining pending session not done. Reversible — the sessions
 * stay in the plan, flagged, exactly like any skip. */
export function skipAllPending() {
  return apiClient.post<{ skipped: number }>('/api/v1/plans/reconcile/skip-all', {});
}
