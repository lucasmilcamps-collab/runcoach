import { apiClient } from '@/lib/api/client';

export type GarminConnectResult = {
  status: 'connected';
};

/**
 * Garmin Connect has no public OAuth app flow (see garmin-sync skill): the
 * user's own Garmin credentials are submitted once, the backend logs in via
 * python-garminconnect and stores only the resulting session tokens.
 */
export function connectGarmin(garminEmail: string, garminPassword: string) {
  return apiClient.post<GarminConnectResult>('/api/v1/garmin/connect', {
    garmin_email: garminEmail,
    garmin_password: garminPassword,
  });
}
