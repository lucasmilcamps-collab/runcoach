import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ApiError } from '@/lib/api/client';
import { getPlanJob, type PlanJob } from '@/lib/api/plans';
import { invalidatePlanReads, qk } from '@/lib/query-keys';
import * as secureStorage from '@/lib/secure-storage';

/** How often the job is polled. Generation takes minutes, so a tight interval
 * would only add requests; slower than this and the plan sits ready unnoticed. */
const POLL_MS = 3000;

/**
 * Where the in-flight job id is kept across a reload.
 *
 * A PWA sent to the background on iOS is routinely torn down and reloaded after
 * a couple of minutes — which is well inside a generation. The id lived in
 * `useState`, so that reload lost it: the server finished the plan and the
 * client never found out, leaving a user who had waited four minutes staring at
 * a screen that had forgotten what it was waiting for.
 */
const JOB_ID_KEY = 'runcoach.plan_job_id';

/** What the screen is waiting on, when it is waiting on anything. */
export type GenerationPhase =
  /** Not generating. */
  | 'idle'
  /** The request that queues the job, or a job the server hasn't picked up yet. */
  | 'queued'
  /** The model is writing. */
  | 'running';

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
 *
 * It also survives the app being reloaded mid-generation: the job id is
 * persisted and picked back up on mount. Any screen holding this hook adopts a
 * generation already in flight, which is what makes a reload land back on a
 * live progress state instead of an idle form — and, incidentally, stops a
 * second screen from offering to start one on top of it.
 */
export function usePlanGeneration<TArg>(
  start: (arg: TArg) => Promise<PlanJob>,
  { onDone }: Options = {},
) {
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);

  /** Persist alongside the state: these two must not drift apart. */
  function trackJob(id: string | null) {
    setJobId(id);
    if (id) void secureStorage.setItem(JOB_ID_KEY, id);
    else void secureStorage.deleteItem(JOB_ID_KEY);
  }

  // Pick up a generation that was already running when this mounted.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await secureStorage.getItem(JOB_ID_KEY);
      // Only adopt if nothing was started in the meantime — a fresh generation
      // from this screen always outranks a remembered one.
      if (stored && !cancelled) setJobId((current) => current ?? stored);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const startMutation = useMutation({
    mutationFn: start,
    onSuccess: (job) => trackJob(job.id),
  });

  const jobQuery = useQuery({
    queryKey: qk.planJob(jobId),
    queryFn: () => getPlanJob(jobId as string),
    enabled: jobId != null,
    // Stop polling as soon as the job settles, either way.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'done' || status === 'failed' ? false : POLL_MS;
    },
  });

  const status = jobQuery.data?.status;

  useEffect(() => {
    if (status !== 'done') return;
    trackJob(null);
    // The plan itself lives behind its own queries; the job only says "ready".
    invalidatePlanReads(queryClient);
    onDone?.();
    // onDone is a fresh closure each render; keying on the status is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, queryClient]);

  useEffect(() => {
    // Failures clear the stored id too, or the next mount would resume a job
    // that is already over and re-show its error out of nowhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    if (status === 'failed') trackJob(null);
  }, [status]);

  // A remembered job that the server no longer knows about (its row aged out,
  // or the session changed) would otherwise leave the screen waiting forever.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    if (jobQuery.error instanceof ApiError) trackJob(null);
  }, [jobQuery.error]);

  const phase: GenerationPhase = (() => {
    if (startMutation.isPending || status === 'pending') return 'queued';
    if (status === 'running') return 'running';
    return 'idle';
  })();

  const elapsedSeconds = useElapsedSeconds(
    phase === 'idle' ? null : (jobQuery.data?.created_at ?? null),
  );

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
      trackJob(null);
      startMutation.reset();
    },
    // Covers both halves: the request that queues the job, and the wait for the
    // job itself. Screens that only need "is it happening" still use this.
    isGenerating: phase !== 'idle',
    /** 'queued' vs 'running' — several minutes of one undifferentiated spinner
     * is what makes a working generation look like a hung one. */
    phase,
    /** Seconds since the server queued the job, or null when idle. Server-side
     * origin on purpose: it stays right across a reload. */
    elapsedSeconds,
    errorMessage,
  };
}

/** Ticks once a second while `startedAt` is set, so the elapsed time on screen
 * actually moves — a frozen counter reads as a frozen app. */
function useElapsedSeconds(startedAt: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  if (!startedAt) return null;
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return null;
  // Clamped: a client clock a few seconds behind the server's would otherwise
  // start the count at a negative number.
  return Math.max(0, Math.round((now - started) / 1000));
}
