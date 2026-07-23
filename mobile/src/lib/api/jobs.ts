import { apiClient } from '@/lib/api/client';

export type JobStatus = 'pending' | 'running' | 'done' | 'failed';

export type Job = {
  id: string;
  type: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  error_message: string | null;
  result_summary: { activities_synced?: number } | null;
};

export function getJob(jobId: string) {
  return apiClient.get<Job>(`/api/v1/jobs/${jobId}`);
}
