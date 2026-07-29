import type { Activity } from '@/lib/api/activities';
import type { SportType } from '@/lib/api/types';
import type { Plan, PlanWeek } from '@/lib/api/plans';
import { estimateDistanceKm } from '@/lib/plan-format';

export type WeekSport = { sport: SportType; count: number };

export type WeekProgress = {
  rangeLabel: string;
  done: { count: number; km: number; minutes: number };
  target: { count: number; km: number };
  // Every sport logged this week, running first — this is how cross-training
  // (padel, basket…) is made visible as load rather than hidden in the totals.
  sports: WeekSport[];
};

/** Monday 00:00 of the week containing `d` (fr week starts Monday). */
function startOfWeek(d: Date): Date {
  const dayFromMonday = (d.getDay() + 6) % 7; // Sun=0 → 6, Mon=1 → 0
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  s.setDate(s.getDate() - dayFromMonday);
  return s;
}

const fmtDay = (d: Date) =>
  new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(d);

/** e.g. "27 juil. – 2 août". */
export function currentWeekRangeLabel(now: Date = new Date()): string {
  const start = startOfWeek(now);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${fmtDay(start)} – ${fmtDay(end)}`;
}

/** The plan week whose index matches the real current week, if any. */
export function findWeek(plan: Plan | null, weekIndex: number | null): PlanWeek | null {
  if (!plan || weekIndex == null) return null;
  for (const phase of plan.phases) {
    for (const week of phase.weeks) {
      if (week.index === weekIndex) return week;
    }
  }
  return null;
}

/** Realized (from Garmin/manual activities this calendar week) vs planned
 * (from the plan's current week) — feeds the Accueil ring and the Séances
 * weekly-overview card. */
export function computeWeekProgress(
  activities: Activity[],
  week: PlanWeek | null,
  now: Date = new Date(),
): WeekProgress {
  const start = startOfWeek(now);
  const end = new Date(start);
  end.setDate(start.getDate() + 7); // exclusive upper bound

  let count = 0;
  let meters = 0;
  let seconds = 0;
  const sportCounts = new Map<SportType, number>();
  for (const a of activities) {
    const t = new Date(a.start_time);
    if (t >= start && t < end) {
      count += 1;
      meters += a.distance_m ?? 0;
      seconds += a.duration_s ?? 0;
      sportCounts.set(a.sport, (sportCounts.get(a.sport) ?? 0) + 1);
    }
  }

  // Running first, then the rest by frequency — cross-training stays visible.
  const sports: WeekSport[] = [...sportCounts.entries()]
    .map(([sport, n]) => ({ sport, count: n }))
    .sort((x, y) => (x.sport === 'RUN' ? -1 : y.sport === 'RUN' ? 1 : y.count - x.count));

  const planned = (week?.sessions ?? []).filter((s) => s.type !== 'rest');
  const targetKm = planned.reduce(
    (sum, s) => sum + (estimateDistanceKm(s.duration_min, s.pace_range) ?? 0),
    0,
  );

  return {
    rangeLabel: currentWeekRangeLabel(now),
    done: { count, km: Math.round(meters / 100) / 10, minutes: Math.round(seconds / 60) },
    target: { count: planned.length, km: Math.round(targetKm * 10) / 10 },
    sports,
  };
}
