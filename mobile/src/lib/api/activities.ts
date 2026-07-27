import { apiClient } from '@/lib/api/client';
import type { SportType } from '@/lib/api/types';

export type Activity = {
  id: string;
  garmin_activity_id: number | null;
  sport: SportType;
  garmin_type_key: string | null;
  start_time: string;
  duration_s: number;
  distance_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  training_load: number | null;
  manual: boolean;
  rpe: number | null;
  note: string | null;
};

export type ManualActivityCreate = {
  sport: SportType;
  start_time: string; // ISO
  duration_min: number;
  rpe: number; // 1–10
  distance_km?: number | null;
  note?: string | null;
};

export function listActivities() {
  return apiClient.get<Activity[]>('/api/v1/activities');
}

export function createManualActivity(payload: ManualActivityCreate) {
  return apiClient.post<Activity>('/api/v1/activities', payload);
}

export function deleteActivity(id: string) {
  return apiClient.delete<void>(`/api/v1/activities/${id}`);
}
