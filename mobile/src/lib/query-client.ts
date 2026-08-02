import { QueryClient } from '@tanstack/react-query';

/**
 * One place for the defaults every query in the app was restating.
 *
 * `retry: false` — this was repeated at 18 call sites, and the reason is the
 * same everywhere: the backend answers a missing plan with a 404 and a stable
 * `detail.code`, which the screens read to decide what to render. Retrying that
 * three times only delays an answer we already have. Genuine transient failures
 * are covered elsewhere — the API client refreshes an expired token and replays
 * the request itself, and a real network drop now falls back to the service
 * worker's cache.
 *
 * `staleTime` — the app is a PWA read on mobile data, and every screen return
 * remounts its queries. Five minutes matches how fast this data actually moves
 * (a plan is regenerated occasionally, activities arrive with a Garmin sync)
 * and, more importantly, nothing here depends on the clock to stay correct:
 * every mutation invalidates the reads it touches, so freshness comes from
 * invalidation, not from polling on remount.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 5 * 60_000,
    },
  },
});
