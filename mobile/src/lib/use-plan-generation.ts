import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ApiError } from '@/lib/api/client';
import { getPlanJob, type PlanJob } from '@/lib/api/plans';

/** How often the job is polled. Generation takes minutes, so a tight interval
 * would only add requests; slower than this and the plan sits ready unnoticed. */
const POLL_MS = 3000;

type Options = {
  /** Runs once the plan is generated and stored — usually a `router.back()`. */
  onDone?: () => void;
};

/**
 * Drives a plan generation from the client side: start it, poll its job, and
 * refresh the plan screens when it lands.
 *
 * Generation is a background job on the server because a long plan costs
 * minutes of model time. That makes it the caller's problem to know when it
 * finished — this hook is that, in one place, so the three screens that can
 * trigger a generation (setup, replan, injury) behave identically.
 */
export function usePlanGeneration<TArg>(
  start: (arg: TArg) => Promise<PlanJob>,
  { onDone }: Options = {},
) {
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);

  const startMutation = useMutation({
    mutationFn: start,
    onSuccess: (job) => setJobId(job.id),
  });

  const jobQuery = useQuery({
    queryKey: ['plan-job', jobId],
    queryFn: () => getPlanJob(jobId as string),
    enabled: jobId != null,
    // Stop polling as soon as the job settles, either way.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'done' || status === 'failed' ? false : POLL_MS;
    },
    retry: false,
  });

  const status = jobQuery.data?.status;

  useEffect(() => {
    if (status !== 'done') return;
    setJobId(null);
    // The plan itself lives behind its own queries; the job only says "ready".
    queryClient.invalidateQueries({ queryKey: ['plan'] });
    queryClient.invalidateQueries({ queryKey: ['plan-today'] });
    queryClient.invalidateQueries({ queryKey: ['plan-progress'] });
    queryClient.invalidateQueries({ queryKey: ['plan-overview'] });
    queryClient.invalidateQueries({ queryKey: ['plan-versions'] });
    onDone?.();
    // onDone is a fresh closure each render; keying on the status is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, queryClient]);

  useEffect(() => {
    if (status === 'failed') setJobId(null);
  }, [status]);

  const errorMessage = (() => {
    if (jobQuery.data?.status === 'failed') {
      return jobQuery.data.error_message ?? 'La génération a échoué.';
    }
    if (startMutation.error instanceof ApiError) return startMutation.error.message;
    if (startMutation.isError) return 'Impossible de contacter le serveur. Réessayez.';
    if (jobQuery.error instanceof ApiError) return jobQuery.error.message;
    return undefined;
  })();

  return {
    generate: (arg: TArg) => startMutation.mutate(arg),
    /** Clear a failed attempt — screens call this when a field is edited. */
    reset: () => {
      setJobId(null);
      startMutation.reset();
    },
    // Pending covers both halves: the request that queues the job, and the wait
    // for the job itself. A screen only ever needs "is it happening".
    isGenerating: startMutation.isPending || status === 'pending' || status === 'running',
    errorMessage,
  };
}
