import type { Activity } from '@/lib/api/activities';
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

export type FixedSport = { sport: SportType; day: Weekday; flexible: boolean };

export type StrengthPref = {
  enabled: boolean;
  sessions_per_week: number; // 1–2
  duration_min: number; // 10–45
};

export type PlanRequest = {
  goal_type: 'race' | 'distance' | 'fitness';
  distance_km: number | null;
  race_date: string | null; // ISO date
  target_time_min: number | null;
  /** Monday week 1 begins on (ISO date). Null lets the server choose: the
   * current week while it still has room to train, next Monday otherwise. */
  start_date: string | null;
  available_days: Weekday[];
  min_run_sessions_per_week: number;
  max_run_sessions_per_week: number;
  fixed_sports: FixedSport[];
  include_cross_training: boolean;
  strength: StrengthPref;
};

export type SessionType =
  | 'easy'
  | 'long_run'
  | 'tempo'
  | 'threshold'
  | 'intervals'
  | 'recovery'
  | 'cross_training'
  | 'strength'
  | 'test'
  | 'race'
  | 'rest';

export type PaceRange = { min_per_km_low: string; min_per_km_high: string };

export type PlanBlock = {
  label: string;
  duration_min: number;
  hr_zone: number | null;
  pace_range: PaceRange | null;
};

export type PlanSession = {
  day: Weekday;
  sport: SportType;
  type: SessionType;
  duration_min: number;
  structure: PlanBlock[];
  pace_range: PaceRange | null;
  hr_zone: number | null;
  priority: 'key' | 'optional';
  slot: 'primary' | 'addon';
  rationale: string;
  /** Declared skipped for this week (a per-week override, reversible). The
   * session stays in the plan — the decision is worth seeing. */
  skipped: boolean;
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
  estimated_time_min: number | null; // estimated current time at the target
  /**
   * How far that estimate can be trusted, from the distance between the effort
   * it was extrapolated from and the target (Riegel drifts as the ratio grows).
   * It was computed server-side all along but never surfaced, so the app showed
   * a race time with the authority of a number the engine itself rated "low".
   */
  estimated_time_confidence: 'high' | 'medium' | 'low' | null;
  projected_time_min: number | null; // projected time at the plan's end
  feasibility_warning: string | null;
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
  sessions: PlanSession[];
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
/** Queues a comeback replan and returns its job — same polling as a fresh
 * generation (see `createPlan`). */
export function reportInjury(injury: InjuryReport) {
  return apiClient.post<PlanJob>('/api/v1/plans/replan-injury', injury);
}

export function getCurrentPlan() {
  return apiClient.get<PlanResponse>('/api/v1/plans/current');
}

/** One stored plan version, read-only. */
export type PlanVersionSummary = {
  version: number;
  created_at: string;
  status: 'ready' | 'cancelled';
  /** Whether this version is the plan currently driving the app. Comes from the
   * server: "the newest one" stopped being the rule once a plan could be
   * stopped, and re-deriving it here would just be a second place to get wrong. */
  is_active: boolean;
  goal_description: string | null;
  race_date: string | null;
  weeks_total: number | null;
  reason: string;
  injury_area: string | null;
  estimated_time_min: number | null;
  projected_time_min: number | null;
};

export function getPlanVersions() {
  return apiClient.get<PlanVersionSummary[]>('/api/v1/plans/versions');
}

export function getPlanVersion(version: number) {
  return apiClient.get<PlanResponse>(`/api/v1/plans/versions/${version}`);
}

/**
 * Bring a past version back as the active plan.
 *
 * Non-destructive: the version is copied forward as a new one, so the plan it
 * replaces stays in the history and a restore can itself be undone. This is the
 * way back from a regeneration that rebuilt a week already run.
 */
export function restorePlanVersion(version: number) {
  return apiClient.post<PlanResponse>(`/api/v1/plans/versions/${version}/restore`, {});
}

/** One week of a plan, committed-to versus actually run. Key runs only. */
export type WeekAdherence = {
  week_index: number;
  planned: number;
  completed: number;
  is_deload: boolean;
  /** A week is only scored once it is over — an unfinished week isn't "missed". */
  is_past: boolean;
  is_current: boolean;
};

/** What the plan summary screen needs beyond the plan document: where its weeks
 * fall on the calendar, and how much of it was actually run. Everything
 * derivable from the plan itself (volume, phases, sessions per week) is
 * computed client-side rather than sent twice. */
export type PlanOverview = {
  version: number;
  start_date: string; // ISO date
  end_date: string; // ISO date, inclusive
  week_current: number | null;
  weeks_total: number;
  planned: number; // totals over elapsed weeks only
  completed: number;
  weeks: WeekAdherence[];
};

export function getPlanOverview(version: number) {
  return apiClient.get<PlanOverview>(`/api/v1/plans/versions/${version}/overview`);
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
/** A queued plan generation. */
export type PlanJob = {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  /** When the job was queued (ISO, UTC). The server's clock is the only honest
   * source for "how long has this been running": the client's own start time is
   * lost the moment the PWA is reloaded mid-generation. */
  created_at: string;
  updated_at: string;
  error_message: string | null;
  result_summary: { plan_id?: string; status?: string } | null;
};

/**
 * Queues a generation and returns its job — it does NOT return a plan.
 *
 * A 17-week plan is ~12.5k output tokens, three to six minutes of model time;
 * no HTTP request should be held open for that. Poll `getPlanJob` until it
 * leaves `pending`/`running`, then read the plan from `getCurrentPlan`.
 * `usePlanGeneration` does all of that.
 */
export function createPlan(request: PlanRequest) {
  return apiClient.post<PlanJob>('/api/v1/plans', request);
}

/**
 * Replan what is left, keeping what has already been run.
 *
 * The weeks up to and including the one under way are frozen exactly as they
 * stand — sessions, moves, duration edits, links — and only the weeks after
 * them are regenerated, from current form. The plan's start date never moves,
 * so the week grid stays put.
 *
 * Takes no body on purpose: the objective comes from the active plan
 * server-side. Changing the objective is a different act, and it lives in
 * plan-setup (`createPlan`), which does rebuild everything.
 *
 * Same job protocol as `createPlan` — poll `getPlanJob`. 404 `NO_ACTIVE_PLAN`
 * when there is nothing to replan from, 409 `NOTHING_TO_REPLAN` when the plan
 * is on its last week.
 */
export function replanPlan() {
  return apiClient.post<PlanJob>('/api/v1/plans/replan', {});
}

export function getPlanJob(jobId: string) {
  return apiClient.get<PlanJob>(`/api/v1/jobs/${jobId}`);
}

/** The activity linked to a planned session, plus that session's calendar date
 * (so the picker can surface activities recorded near it). */
export type SessionLinkInfo = {
  session_date: string; // ISO date
  linked: Activity | null;
};

/** The slot is part of the identity: a day can hold a run and a strength addon,
 * and a link on one must not mark the other done. */
export function getSessionLink(weekIndex: number, day: Weekday, slot: PlanSession['slot'] = 'primary') {
  return apiClient.get<SessionLinkInfo>(
    `/api/v1/plans/session/link?week_index=${weekIndex}&day=${day}&slot=${slot}`,
  );
}

/** Link (activityId) or unlink (null) a recorded activity to a planned session. */
export function setSessionLink(
  weekIndex: number,
  day: Weekday,
  activityId: string | null,
  slot: PlanSession['slot'] = 'primary',
) {
  return apiClient.post<SessionLinkInfo>('/api/v1/plans/session/link', {
    week_index: weekIndex,
    day,
    slot,
    activity_id: activityId,
  });
}

/**
 * Stop the active plan. It leaves every current-plan read (today, progress,
 * per-week overrides) but stays readable in the version history, and a new plan
 * can be generated right after.
 */
export function cancelPlan() {
  return apiClient.post<void>('/api/v1/plans/cancel', {});
}

/**
 * Change a session's duration for one week only. Same override model as a move:
 * the stored plan is untouched and a replan clears it.
 */
export function setSessionDuration(
  weekIndex: number,
  day: Weekday,
  slot: PlanSession['slot'],
  durationMin: number,
) {
  return apiClient.post<PlanResponse>('/api/v1/plans/session/duration', {
    week_index: weekIndex,
    day,
    slot,
    duration_min: durationMin,
  });
}

/**
 * Declare a session skipped for one week only, or take it back. Allowed on runs
 * — unlike deleting one — because it says "not this week" rather than changing
 * the plan. A skipped key session counts as missed straight away and feeds
 * `replan_suggested`; it never regenerates anything on its own.
 */
export function skipSession(
  weekIndex: number,
  day: Weekday,
  slot: PlanSession['slot'],
  skipped: boolean,
) {
  return apiClient.post<PlanResponse>('/api/v1/plans/session/skip', {
    week_index: weekIndex,
    day,
    slot,
    skipped,
  });
}

/**
 * Drop a session for one week only. The backend refuses this for a run: losing
 * one would break the plan's guaranteed run count, which is a replan decision.
 */
export function deleteSession(weekIndex: number, day: Weekday, slot: PlanSession['slot']) {
  return apiClient.post<PlanResponse>('/api/v1/plans/session/delete', {
    week_index: weekIndex,
    day,
    slot,
  });
}

/**
 * Move a session to another weekday for one week only (a per-week override —
 * the stored plan is untouched). Returns the updated current plan.
 */
export function moveSession(weekIndex: number, fromDay: Weekday, toDay: Weekday) {
  return apiClient.post<PlanResponse>('/api/v1/plans/session/move', {
    week_index: weekIndex,
    from_day: fromDay,
    to_day: toDay,
  });
}
