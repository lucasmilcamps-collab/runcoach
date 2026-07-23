import { apiClient } from '@/lib/api/client';

export type GarminConnectResult = {
  status: 'connected' | 'needs_mfa';
  mfa_token: string | null;
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
