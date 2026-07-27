import { apiClient } from '@/lib/api/client';
import type { PaceRange, PlanBlock } from '@/lib/api/plans';

export type GarminConnectResult = {
  status: 'connected' | 'needs_mfa';
  mfa_token: string | null;
};

export type GarminSyncResult = {
  status: 'done' | 'failed' | 'skipped';
  activities_synced: number | null;
  error_message: string | null;
};

/**
 * Garmin Connect has no public OAuth app flow (see garmin-sync skill): the
 * user's own Garmin credentials are submitted once, the backend logs in via
 * python-garminconnect and stores only the resulting session tokens.
 *
 * Accounts with 2FA enabled make this a two-step flow: this call returns
 * status "needs_mfa" with a short-lived mfa_token instead of connecting
 * directly; completeGarminMfa finishes it with the code Garmin emails.
 */
export function connectGarmin(garminEmail: string, garminPassword: string) {
  return apiClient.post<GarminConnectResult>('/api/v1/garmin/connect', {
    garmin_email: garminEmail,
    garmin_password: garminPassword,
  });
}

export function completeGarminMfa(mfaToken: string, mfaCode: string) {
  return apiClient.post<GarminConnectResult>('/api/v1/garmin/connect/mfa', {
    mfa_token: mfaToken,
    mfa_code: mfaCode,
  });
}

/**
 * Runs a Garmin activity sync and resolves only when it's finished (the
 * backend does the work synchronously, on a free host where a background
 * task could be killed mid-run). Throttled server-side, so a call within
 * the cooldown resolves quickly with status "skipped".
 */
export function syncGarmin() {
  return apiClient.post<GarminSyncResult>('/api/v1/garmin/sync');
}

export type WorkoutPushResult = {
  status: 'done' | 'failed';
  workout_name: string | null;
  error_message: string | null;
};

export type WorkoutPushPayload = {
  session_type: string;
  duration_min: number;
  structure: PlanBlock[];
  pace_range: PaceRange | null;
  hr_zone: number | null;
  rationale?: string | null;
  week_number?: number | null;
};

/**
 * Upload a plan session to Garmin Connect as a structured running workout. It
 * lands in the user's Garmin workout library and syncs to the paired watch on
 * Garmin's next connection (no direct device push exists).
 */
export function pushWorkoutToWatch(payload: WorkoutPushPayload) {
  return apiClient.post<WorkoutPushResult>('/api/v1/garmin/workout', payload);
}
