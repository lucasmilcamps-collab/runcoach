import type { QueryClient } from '@tanstack/react-query';

import type { PlanSession, Weekday } from '@/lib/api/plans';

/**
 * Every TanStack Query key in the app, in one place.
 *
 * Keys were written as inline literals at ~40 call sites, which is how the app
 * shipped a bug: a `plan-overview` invalidation was simply forgotten when a new
 * screen started reading that key, and nothing could have caught it — a typo or
 * an omission in an array literal is not a type error. It also let the same
 * cache entry be spelled two ways (`['session-link', weekIndex, …]` in the
 * picker, `['session-link', weekNumber, …]` in the detail screen: same value,
 * two names, and no way to see they were the same key).
 *
 * With the keys behind functions, a read and its invalidation are the same
 * expression, and adding an argument to a key is a compile error at every site
 * that builds it.
 *
 * Shape follows the TanStack convention: the broad key is a prefix of the
 * narrow one, so `invalidateQueries({ queryKey: qk.planVersion.all() })`
 * catches every version. `as const` keeps the tuples literal-typed.
 */
export const qk = {
  /** The signed-in user. */
  me: () => ['me'] as const,

  /** Recorded activities (Garmin + manual). */
  activities: () => ['activities'] as const,

  /** Fitness profile: zones, CTL/ATL/TSB series. */
  fitness: () => ['fitness'] as const,

  /** The active plan document. */
  plan: () => ['plan'] as const,

  /** Today's session, adjusted for current form. */
  planToday: () => ['plan-today'] as const,

  /** Week/adherence counters driving the replan suggestion. */
  planProgress: () => ['plan-progress'] as const,

  /** The review of the week that just ended, and its adjustment verdict. */
  weeklyReview: () => ['weekly-review'] as const,

  /** The stored plan versions, newest first. */
  planVersions: () => ['plan-versions'] as const,

  /** Calendar + adherence for one stored version. */
  planOverview: {
    all: () => ['plan-overview'] as const,
    byVersion: (version: number) => ['plan-overview', version] as const,
  },

  /** One stored plan version, read-only. */
  planVersion: {
    all: () => ['plan-version'] as const,
    byVersion: (version: number) => ['plan-version', version] as const,
  },

  /**
   * The activity linked to one planned session. The slot is part of the
   * identity: a day can hold a run and a strength add-on, and a link on one
   * must not mark the other done.
   *
   * Arguments are optional because both call sites build this key before the
   * session is known (route params still parsing, or a query held `disabled`).
   */
  sessionLink: (
    weekIndex: number | undefined,
    day: Weekday | undefined,
    slot: PlanSession['slot'] | undefined,
  ) => ['session-link', weekIndex, day, slot] as const,

  /** A background plan generation. */
  planJob: (jobId: string | null) => ['plan-job', jobId] as const,
} as const;

/**
 * The six reads a finished generation — or any change to the stored plan —
 * makes stale, invalidated together.
 *
 * They travel as a set because they are six views of one document, and the
 * cost of forgetting one is a screen quietly showing the previous plan. That
 * list only ever existed inside `use-plan-generation`; every other place that
 * replaced a plan (the settings screen's cancel, for one) re-typed its own
 * subset and got to decide, by accident, which screens would lie.
 */
export function invalidatePlanReads(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: qk.plan() });
  queryClient.invalidateQueries({ queryKey: qk.planToday() });
  queryClient.invalidateQueries({ queryKey: qk.planProgress() });
  queryClient.invalidateQueries({ queryKey: qk.planOverview.all() });
  queryClient.invalidateQueries({ queryKey: qk.planVersions() });
  // The review is read against the plan's own week grid, so a new plan makes
  // last week's verdict describe a week that no longer exists.
  queryClient.invalidateQueries({ queryKey: qk.weeklyReview() });
}
