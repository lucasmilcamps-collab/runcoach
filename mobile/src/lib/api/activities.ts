import { apiClient } from '@/lib/api/client';
import type { SportType } from '@/lib/api/types';

export type Activity = {
  id: string;
  garmin_activity_id: number;
  sport: SportType;
  garmin_type_key: string | null;
  start_time: string;
  duration_s: number;
  distance_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  training_load: number | null;
};

export function listActivities() {
  return apiClient.get<Activity[]>('/api/v1/activities');
}
